#!/usr/bin/env python3
"""Parse Prowler ISO/IEC 27001:2022 CSV and OCSF JSON into sanitized Watchtower dashboard telemetry."""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROWLER_DIR = ROOT / "prowler-output"
RISK_REGISTER_PATH = ROOT / "policies" / "risk_register.json"
DASHBOARD_DATA_DIR = ROOT / "dashboard" / "data"
LATEST_OUT = DASHBOARD_DATA_DIR / "latest.json"
HISTORY_OUT = DASHBOARD_DATA_DIR / "history.json"


def mask_account_ids(text: str) -> str:
    """Mask 12-digit AWS account IDs to preserve portfolio privacy."""
    if not text:
        return ""
    return re.sub(r"\b(\d{8})(\d{4})\b", r"********\2", text)


def find_latest_file(base_dir: Path, pattern: str) -> Path | None:
    matches = sorted(base_dir.rglob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return matches[0] if matches else None


def load_ocsf_severities(ocsf_path: Path | None) -> dict[str, str]:
    """Map Prowler check_id -> severity from OCSF JSON when available."""
    severities: dict[str, str] = {}
    if not ocsf_path or not ocsf_path.exists():
        return severities
    try:
        data = json.loads(ocsf_path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            for item in data:
                check_id = (
                    item.get("metadata", {}).get("event_code")
                    or item.get("finding_info", {}).get("uid", "")
                )
                severity = item.get("severity", "Unknown")
                if check_id and check_id not in severities:
                    severities[check_id] = severity
    except Exception as exc:
        print(f"[warn] Could not parse OCSF JSON ({exc}); defaulting severities.", file=sys.stderr)
    return severities


def load_risk_register() -> dict:
    if not RISK_REGISTER_PATH.exists():
        return {"metadata": {}, "exceptions": {}}
    return json.loads(RISK_REGISTER_PATH.read_text(encoding="utf-8"))


def main() -> int:
    csv_path = find_latest_file(PROWLER_DIR, "*iso27001_2022_aws.csv")
    if not csv_path:
        print(f"[error] No *iso27001_2022_aws.csv found under {PROWLER_DIR}", file=sys.stderr)
        return 1

    ocsf_path = find_latest_file(PROWLER_DIR, "*.ocsf.json")
    severities = load_ocsf_severities(ocsf_path)
    risk_register = load_risk_register()
    exceptions = risk_register.get("exceptions", {})

    counts = {"PASS": 0, "FAIL": 0, "MANUAL": 0, "RISK_ACCEPTED": 0, "NOT_APPLICABLE": 0, "OPEN_FAIL": 0}
    domains: dict[str, dict[str, int]] = defaultdict(
        lambda: {"pass": 0, "open_fail": 0, "governed": 0, "manual": 0}
    )
    findings = []
    assessment_date = ""
    region = "us-east-1"

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for row in reader:
            status = (row.get("STATUS") or "").strip().upper()
            check_id = (row.get("CHECKID") or "").strip()
            req_id = (row.get("REQUIREMENTS_ID") or "").strip()
            req_name = (row.get("REQUIREMENTS_NAME") or "").strip()
            category = (row.get("REQUIREMENTS_ATTRIBUTES_CATEGORY") or "Uncategorized").strip()
            objective_id = (
                row.get("REQUIREMENTS_ATTRIBUTES_OBJETIVE_ID")
                or row.get("REQUIREMENTS_ATTRIBUTES_OBJECTIVE_ID")
                or ""
            ).strip()
            objective_name = (
                row.get("REQUIREMENTS_ATTRIBUTES_OBJETIVE_NAME")
                or row.get("REQUIREMENTS_ATTRIBUTES_OBJECTIVE_NAME")
                or ""
            ).strip()
            extended = mask_account_ids(
                (row.get("STATUSEXTENDED") or row.get("STATUS_EXTENDED") or "").strip()
            )
            resource_name = mask_account_ids(
                (row.get("RESOURCENAME") or row.get("RESOURCEID") or "").strip()
            )

            if not assessment_date and row.get("ASSESSMENTDATE"):
                assessment_date = row["ASSESSMENTDATE"].strip()
            if row.get("REGION"):
                region = row["REGION"].strip()

            governance = exceptions.get(check_id) if status == "FAIL" else None
            effective_status = status

            if status == "PASS":
                counts["PASS"] += 1
                domains[category]["pass"] += 1
            elif status == "MANUAL":
                counts["MANUAL"] += 1
                domains[category]["manual"] += 1
            elif status == "FAIL":
                counts["FAIL"] += 1
                if governance:
                    decision = governance.get("decision", "RISK_ACCEPTED")
                    effective_status = decision
                    counts[decision] = counts.get(decision, 0) + 1
                    domains[category]["governed"] += 1
                else:
                    counts["OPEN_FAIL"] += 1
                    domains[category]["open_fail"] += 1

            findings.append(
                {
                    "control_id": req_id,
                    "control_name": req_name,
                    "category": category,
                    "objective_id": objective_id,
                    "objective_name": objective_name,
                    "check_id": check_id,
                    "raw_status": status,
                    "effective_status": effective_status,
                    "severity": severities.get(check_id, "Medium" if status == "FAIL" else "Informational"),
                    "resource": resource_name,
                    "details": extended,
                    "governance": governance,
                }
            )

    automated_total = counts["PASS"] + counts["FAIL"]
    raw_score = round((counts["PASS"] / automated_total) * 100, 1) if automated_total else 0.0
    governed_pass = counts["PASS"] + counts["RISK_ACCEPTED"] + counts["NOT_APPLICABLE"]
    governed_score = round((governed_pass / automated_total) * 100, 1) if automated_total else 0.0

    scan_timestamp = assessment_date or datetime.now(timezone.utc).isoformat()

    payload = {
        "project": "Project Watchtower",
        "framework": "ISO/IEC 27001:2022",
        "region": region,
        "scan_timestamp": scan_timestamp,
        "summary": {
            "total_evaluated": automated_total + counts["MANUAL"],
            "automated_total": automated_total,
            "pass": counts["PASS"],
            "raw_fail": counts["FAIL"],
            "open_fail": counts["OPEN_FAIL"],
            "risk_accepted": counts["RISK_ACCEPTED"],
            "not_applicable": counts["NOT_APPLICABLE"],
            "manual": counts["MANUAL"],
            "raw_compliance_pct": raw_score,
            "governed_compliance_pct": governed_score,
        },
        "domains": [
            {"name": name, **stats} for name, stats in sorted(domains.items())
        ],
        "risk_register_meta": risk_register.get("metadata", {}),
        "findings": findings,
    }

    DASHBOARD_DATA_DIR.mkdir(parents=True, exist_ok=True)
    LATEST_OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    # Append deduplicated point to history.json for trend visualization
    history = []
    if HISTORY_OUT.exists():
        try:
            history = json.loads(HISTORY_OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            history = []

    snapshot = {
        "timestamp": scan_timestamp,
        "pass": counts["PASS"],
        "raw_fail": counts["FAIL"],
        "open_fail": counts["OPEN_FAIL"],
        "governed": counts["RISK_ACCEPTED"] + counts["NOT_APPLICABLE"],
        "raw_compliance_pct": raw_score,
        "governed_compliance_pct": governed_score,
    }
    if not history or history[-1].get("timestamp") != scan_timestamp:
        history.append(snapshot)
        history = history[-30:]
        HISTORY_OUT.write_text(json.dumps(history, indent=2), encoding="utf-8")

    print(f"Parsed: {csv_path.name}")
    print(f"Raw Automated Score     : {raw_score}% ({counts['PASS']}/{automated_total} PASS)")
    print(f"Governed Effective Score: {governed_score}% ({counts['OPEN_FAIL']} open fails remaining)")
    print(f"Wrote: {LATEST_OUT} & {HISTORY_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
