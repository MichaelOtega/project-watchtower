(function () {
  const state = {
    latest: null,
    history: [],
    statusFilter: "ALL",
    domainFilter: "ALL",
    search: "",
    charts: {}
  };

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTimestamp(ts) {
    if (!ts) return "--";
    const iso = ts.includes("T") ? ts : ts.replace(" ", "T") + "Z";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short"
    });
  }

  function shortLabel(ts) {
    if (!ts) return "";
    const parts = ts.split(/[ T]/);
    if (parts.length >= 2) {
      return `${parts[0].slice(5)} ${parts[1].slice(0, 5)} UTC`;
    }
    return ts;
  }

  function statusBadge(status) {
    const norm = String(status || "MANUAL").toUpperCase();
    const labelMap = {
      PASS: "PASS",
      FAIL: "OPEN FAIL",
      RISK_ACCEPTED: "RISK ACCEPTED",
      NOT_APPLICABLE: "NOT APPLICABLE",
      MANUAL: "MANUAL"
    };
    return `<span class="badge badge-${norm.toLowerCase()}">${esc(labelMap[norm] || norm)}</span>`;
  }

  function renderHeader(latest) {
    const meta = latest.risk_register_meta || {};
    document.getElementById("projectTitle").textContent = latest.project || "Project Watchtower";
    document.getElementById("frameworkBadge").textContent = latest.framework || meta.framework || "ISO/IEC 27001:2022";
    document.getElementById("regionBadge").textContent = `AWS ${latest.region || "us-east-1"}`;
    const guardrail = meta.budget_guardrail_usd != null ? `$${Number(meta.budget_guardrail_usd).toFixed(2)}/mo cap` : "$0.00/mo";
    document.getElementById("budgetBadge").textContent = `FinOps Guardrail: ${guardrail}`;
    document.getElementById("lastScanBadge").textContent = `Last Scan: ${formatTimestamp(latest.scan_timestamp)}`;
    document.getElementById("footerOwner").textContent = `Owner: ${meta.owner || "Michael Loya (SecOps & GRC)"} | Review Cycle: ${meta.review_cycle || "Quarterly"}`;
  }

  function setDelta(elId, diff, suffix, invertGood) {
    const el = document.getElementById(elId);
    if (diff === null || diff === undefined || Number.isNaN(diff) || diff === 0) {
      el.textContent = "";
      el.className = "kpi-delta";
      return;
    }
    const sign = diff > 0 ? "+" : "";
    const isGood = invertGood ? diff < 0 : diff > 0;
    el.textContent = `${sign}${diff.toFixed(suffix === "%" ? 1 : 0)}${suffix}`;
    el.className = `kpi-delta ${isGood ? "delta-up" : "delta-down"}`;
  }

  function renderKpis(latest, history) {
    const s = latest.summary || {};
    const first = history.length > 1 ? history[0] : null;
    const govCount = (s.risk_accepted || 0) + (s.not_applicable || 0);

    document.getElementById("kpiGovernedPct").textContent = `${Number(s.governed_compliance_pct || 0).toFixed(1)}%`;
    document.getElementById("kpiGovernedBar").style.width = `${Math.min(100, Number(s.governed_compliance_pct || 0))}%`;
    document.getElementById("kpiGovernedSub").textContent = `${(s.pass || 0) + govCount} of ${s.automated_total || 0} automated controls satisfied`;

    document.getElementById("kpiRawPct").textContent = `${Number(s.raw_compliance_pct || 0).toFixed(1)}%`;
    document.getElementById("kpiRawBar").style.width = `${Math.min(100, Number(s.raw_compliance_pct || 0))}%`;
    document.getElementById("kpiRawSub").textContent = `${s.pass || 0} strict passes (${s.raw_fail || 0} raw fails)`;

    const openEl = document.getElementById("kpiOpenFail");
    openEl.textContent = s.open_fail ?? 0;
    openEl.className = `kpi-value ${(s.open_fail || 0) === 0 ? "text-pass" : "text-fail"}`;
    document.getElementById("kpiOpenFailSub").textContent = (s.open_fail || 0) === 0
      ? "Zero unmitigated failures"
      : "Requires remediation or governance";

    document.getElementById("kpiPass").textContent = s.pass ?? 0;
    document.getElementById("kpiPassSub").textContent = `of ${s.automated_total || 0} automated (${s.total_evaluated || 0} total)`;

    document.getElementById("kpiGovernedCount").textContent = govCount;
    document.getElementById("kpiManualCount").textContent = `${s.manual || 0} manual`;
    document.getElementById("kpiGovBreakdown").textContent = `${s.risk_accepted || 0} risk accepted / ${s.not_applicable || 0} N/A`;

    if (first) {
      setDelta("kpiGovernedDelta", Number(s.governed_compliance_pct) - Number(first.governed_compliance_pct), "%", false);
      setDelta("kpiRawDelta", Number(s.raw_compliance_pct) - Number(first.raw_compliance_pct), "%", false);
      setDelta("kpiOpenFailDelta", Number(s.open_fail) - Number(first.open_fail), "", true);
    }
  }

  function renderTrendChart(history) {
    document.getElementById("scanCountBadge").textContent = `${history.length} Scan${history.length === 1 ? "" : "s"}`;
    const ctx = document.getElementById("trendChart").getContext("2d");
    if (state.charts.trend) state.charts.trend.destroy();

    state.charts.trend = new Chart(ctx, {
      type: "line",
      data: {
        labels: history.map((h) => shortLabel(h.timestamp)),
        datasets: [
          {
            label: "Governed Compliance %",
            data: history.map((h) => h.governed_compliance_pct),
            borderColor: "#1d4ed8",
            backgroundColor: "rgba(29, 78, 216, 0.12)",
            borderWidth: 3,
            pointRadius: 4,
            clip: false,
            fill: true,
            tension: 0.25
          },
          {
            label: "Raw Automated %",
            data: history.map((h) => h.raw_compliance_pct),
            borderColor: "#0284c7",
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 4,
            clip: false,
            fill: false,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 10, right: 14 } },
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: { callback: (v) => `${v}%` },
            grid: { color: "#e2e8f0" }
          },
          x: { grid: { display: false } }
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.parsed.y}%`
            }
          }
        }
      }
    });
  }

  function renderDomainChart(domains) {
    const ctx = document.getElementById("domainChart").getContext("2d");
    if (state.charts.domains) state.charts.domains.destroy();

    state.charts.domains = new Chart(ctx, {
      type: "bar",
      data: {
        labels: domains.map((d) => d.name),
        datasets: [
          { label: "Pass", data: domains.map((d) => d.pass), backgroundColor: "#1d4ed8" },
          { label: "Governed", data: domains.map((d) => d.governed), backgroundColor: "#60a5fa" },
          { label: "Open Fail", data: domains.map((d) => d.open_fail), backgroundColor: "#dc2626" },
          { label: "Manual", data: domains.map((d) => d.manual), backgroundColor: "#cbd5e1" }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { color: "#e2e8f0" } },
          y: { stacked: true, grid: { display: false } }
        },
        plugins: {
          legend: { position: "bottom" }
        }
      }
    });
  }

  function populateDomains(domains) {
    const sel = document.getElementById("domainFilter");
    sel.innerHTML = `<option value="ALL">All Annex A Domains</option>` +
      domains.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("");
  }

  function getFilteredFindings() {
    const q = state.search.trim().toLowerCase();
    return (state.latest?.findings || []).filter((f) => {
      const eff = String(f.effective_status || "").toUpperCase();
      if (state.statusFilter !== "ALL" && eff !== state.statusFilter) return false;
      if (state.domainFilter !== "ALL" && f.category !== state.domainFilter) return false;
      if (!q) return true;
      const hay = [
        f.control_id, f.control_name, f.category, f.check_id, f.resource,
        f.details, f.governance?.category, f.governance?.rationale
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function renderFindingsTable() {
    const rows = getFilteredFindings();
    document.getElementById("resultsMeta").textContent = `Showing ${rows.length} of ${(state.latest?.findings || []).length} evaluated controls`;
    const tbody = document.getElementById("findingsBody");

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:28px;">No controls match the active filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((f) => {
      const gov = f.governance
        ? `<div class="gov-note"><strong>${esc(f.governance.category || "Governance")}:</strong> ${esc(f.governance.rationale)}<br/><em>Compensating Control:</em> ${esc(f.governance.compensating_control)}</div>`
        : "";
      const resourceHtml = f.resource ? `<div><span class="resource-tag">${esc(f.resource)}</span></div>` : "";
      return `
        <tr>
          <td>
            <div class="control-id">${esc(f.control_id)}</div>
            <div class="control-name">${esc(f.control_name)}</div>
          </td>
          <td>${esc(f.category)}</td>
          <td>
            <div class="mono">${esc(f.check_id || "Manual Assessment")}</div>
            ${resourceHtml}
          </td>
          <td>${statusBadge(f.effective_status)}</td>
          <td>
            <div>${esc(f.details || "--")}</div>
            ${gov}
          </td>
        </tr>
      `;
    }).join("");
  }

  function renderRiskRegister(latest) {
    const meta = latest.risk_register_meta || {};
    document.getElementById("riskMetaStrip").innerHTML = `
      <div><strong>Framework</strong>${esc(meta.framework || latest.framework || "ISO/IEC 27001:2022")}</div>
      <div><strong>Risk Owner</strong>${esc(meta.owner || "--")}</div>
      <div><strong>Review Cycle</strong>${esc(meta.review_cycle || "Quarterly")}</div>
      <div><strong>Last Reviewed</strong>${esc(meta.last_reviewed || "--")}</div>
      <div><strong>Budget Guardrail</strong>$${Number(meta.budget_guardrail_usd ?? 0).toFixed(2)}/mo</div>
    `;

    const grouped = new Map();
    for (const f of latest.findings || []) {
      if (!f.governance) continue;
      const key = `${f.check_id}|${f.governance.decision}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          check_id: f.check_id,
          governance: f.governance,
          controls: new Set(),
          resources: new Set()
        });
      }
      const entry = grouped.get(key);
      if (f.control_id) entry.controls.add(f.control_id);
      if (f.resource) entry.resources.add(f.resource);
    }

    const container = document.getElementById("riskCards");
    if (!grouped.size) {
      container.innerHTML = `<p style="color:#64748b;">No risk register exceptions applied in this scan.</p>`;
      return;
    }

    container.innerHTML = Array.from(grouped.values()).map((item) => `
      <article class="risk-card">
        <div class="risk-card-head">
          <h3>${esc(item.check_id)}</h3>
          ${statusBadge(item.governance.decision)}
        </div>
        <div class="risk-meta-line">
          <strong>Category:</strong> ${esc(item.governance.category)} &bull;
          <strong>Controls:</strong> ${esc(Array.from(item.controls).sort().join(", "))}
        </div>
        <p><strong>Rationale:</strong> ${esc(item.governance.rationale)}</p>
        <p><strong>Compensating Control:</strong> ${esc(item.governance.compensating_control)}</p>
        ${item.resources.size ? `<div class="risk-meta-line" style="margin-top:8px;"><strong>Resources:</strong> ${esc(Array.from(item.resources).join(", "))}</div>` : ""}
      </article>
    `).join("");
  }

  function exportCsv() {
    const rows = getFilteredFindings();
    const cols = ["control_id", "control_name", "category", "check_id", "raw_status", "effective_status", "resource", "details"];
    const escapeCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(",")].concat(rows.map((r) => cols.map((c) => escapeCsv(r[c])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `watchtower-iso27001-evidence-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const btn = document.getElementById("exportPdfBtn");
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor || !state.latest) {
      alert("PDF library failed to load. Opening browser Print-to-PDF instead.");
      window.print();
      return;
    }

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating PDF...";

    try {
      const doc = new jsPDFCtor({ orientation: "landscape", unit: "pt", format: "a4" });
      if (typeof doc.autoTable !== "function") {
        throw new Error("jspdf-autotable plugin unavailable");
      }

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 36;
      const contentW = pageW - margin * 2;
      const latest = state.latest;
      const s = latest.summary || {};
      const meta = latest.risk_register_meta || {};
      const govCount = (s.risk_accepted || 0) + (s.not_applicable || 0);
      const rows = getFilteredFindings();

      // Header Banner
      doc.setFillColor(15, 41, 74);
      doc.rect(0, 0, pageW, 68, "F");
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 68, pageW, 3, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(`${latest.project || "Project Watchtower"} - Audit Evidence Report`, margin, 27);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(203, 213, 225);
      doc.text(
        `${latest.framework || meta.framework || "ISO/IEC 27001:2022"} | AWS ${latest.region || "us-east-1"} | FinOps Guardrail: $${Number(meta.budget_guardrail_usd ?? 0).toFixed(2)}/mo`,
        margin,
        43
      );
      doc.setFontSize(8.5);
      doc.text(
        `Last Scan: ${formatTimestamp(latest.scan_timestamp)} | Owner: ${meta.owner || "Michael Loya (SecOps & GRC)"} | Review Cycle: ${meta.review_cycle || "Quarterly"}`,
        margin,
        57
      );

      // KPI Strip
      const kpis = [
        { label: "GOVERNED COMPLIANCE", value: `${Number(s.governed_compliance_pct || 0).toFixed(1)}%`, sub: `${(s.pass || 0) + govCount}/${s.automated_total || 0} automated`, color: [29, 78, 216] },
        { label: "RAW AUTOMATED SCORE", value: `${Number(s.raw_compliance_pct || 0).toFixed(1)}%`, sub: `${s.pass || 0} pass / ${s.raw_fail || 0} raw fail`, color: [2, 132, 199] },
        { label: "OPEN FAILURES", value: `${s.open_fail ?? 0}`, sub: (s.open_fail || 0) === 0 ? "Zero unmitigated fails" : "Action required", color: (s.open_fail || 0) === 0 ? [22, 101, 52] : [153, 27, 27] },
        { label: "PASSED AUTOMATED", value: `${s.pass ?? 0}`, sub: `of ${s.automated_total || 0} (${s.total_evaluated || 0} total)`, color: [15, 41, 74] },
        { label: "GOVERNED / MANUAL", value: `${govCount} / ${s.manual || 0}`, sub: `${s.risk_accepted || 0} accepted, ${s.not_applicable || 0} N/A`, color: [15, 41, 74] }
      ];

      const kpiY = 84;
      const kpiGap = 10;
      const kpiW = (contentW - kpiGap * 4) / 5;
      const kpiH = 54;

      kpis.forEach((k, i) => {
        const x = margin + i * (kpiW + kpiGap);
        doc.setFillColor(i === 0 ? 239 : 255, i === 0 ? 246 : 255, i === 0 ? 255 : 255);
        doc.setDrawColor(i === 0 ? 191 : 226, i === 0 ? 219 : 232, i === 0 ? 254 : 240);
        doc.roundedRect(x, kpiY, kpiW, kpiH, 6, 6, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text(k.label, x + 9, kpiY + 14);

        doc.setFontSize(15);
        doc.setTextColor(k.color[0], k.color[1], k.color[2]);
        doc.text(k.value, x + 9, kpiY + 34);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(k.sub, x + 9, kpiY + 46);
      });

      // Charts Row
      const chartY = 150;
      const chartGap = 14;
      const chartBoxW = (contentW - chartGap) / 2;
      const chartBoxH = 168;

      const chartDefs = [
        { id: "trendChart", title: "Compliance Remediation Trajectory" },
        { id: "domainChart", title: "Annex A Domain Posture" }
      ];

      chartDefs.forEach((c, idx) => {
        const x = margin + idx * (chartBoxW + chartGap);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, chartY, chartBoxW, chartBoxH, 6, 6, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(15, 41, 74);
        doc.text(c.title, x + 12, chartY + 18);

        const canvas = document.getElementById(c.id);
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          const img = canvas.toDataURL("image/png", 1.0);
          const maxW = chartBoxW - 20;
          const maxH = chartBoxH - 30;
          const ratio = canvas.width / canvas.height;
          let drawW = maxW;
          let drawH = drawW / ratio;
          if (drawH > maxH) {
            drawH = maxH;
            drawW = drawH * ratio;
          }
          const drawX = x + (chartBoxW - drawW) / 2;
          const drawY = chartY + 24 + (maxH - drawH) / 2;
          doc.addImage(img, "PNG", drawX, drawY, drawW, drawH);
        }
      });

      // Control Assessment Table
      const tableTitleY = chartY + chartBoxH + 22;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(15, 41, 74);
      const filterNote = `Status: ${state.statusFilter} | Domain: ${state.domainFilter}` + (state.search.trim() ? ` | Search: "${state.search.trim()}"` : "");
      doc.text(`Control Assessment Evidence (${rows.length} controls)`, margin, tableTitleY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(filterNote, pageW - margin, tableTitleY, { align: "right" });

      const statusPalette = {
        PASS: { fill: [220, 252, 231], text: [22, 101, 52] },
        FAIL: { fill: [254, 226, 226], text: [153, 27, 27] },
        RISK_ACCEPTED: { fill: [219, 234, 254], text: [30, 64, 175] },
        NOT_APPLICABLE: { fill: [224, 242, 254], text: [7, 89, 133] },
        MANUAL: { fill: [241, 245, 249], text: [71, 85, 105] }
      };

      const findingBody = rows.map((f) => {
        const eff = String(f.effective_status || "MANUAL").toUpperCase();
        const checkAndRes = [f.check_id || "Manual Assessment", f.resource ? `Resource: ${f.resource}` : ""].filter(Boolean).join("\n");
        const evidenceParts = [f.details || "--"];
        if (f.governance) {
          evidenceParts.push(`[${f.governance.category || "Governance"}] ${f.governance.rationale}`);
          evidenceParts.push(`Compensating Control: ${f.governance.compensating_control}`);
        }
        return [
          `${f.control_id || ""}\n${f.control_name || ""}`.trim(),
          f.category || "",
          checkAndRes,
          eff.replace("_", " "),
          evidenceParts.join("\n")
        ];
      });

      doc.autoTable({
        startY: tableTitleY + 8,
        margin: { left: margin, right: margin, bottom: 34 },
        head: [["Control", "Domain", "Check & Resource", "Status", "Evidence & Governance"]],
        body: findingBody.length ? findingBody : [["--", "--", "--", "--", "No controls match active filters."]],
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 5, textColor: [15, 23, 42], overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [15, 41, 74], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 95, fontStyle: "bold" },
          1: { cellWidth: 95 },
          2: { cellWidth: 165 },
          3: { cellWidth: 78, halign: "center", fontStyle: "bold" },
          4: { cellWidth: contentW - 433 }
        },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 3) {
            const key = String(data.cell.raw || "").replace(/ /g, "_").toUpperCase();
            const pal = statusPalette[key];
            if (pal) {
              data.cell.styles.fillColor = pal.fill;
              data.cell.styles.textColor = pal.text;
            }
          }
        }
      });

      // Appendix: Risk Register
      const groupedRisks = new Map();
      for (const f of latest.findings || []) {
        if (!f.governance) continue;
        const key = `${f.check_id}|${f.governance.decision}`;
        if (!groupedRisks.has(key)) {
          groupedRisks.set(key, { check_id: f.check_id, gov: f.governance, controls: new Set() });
        }
        if (f.control_id) groupedRisks.get(key).controls.add(f.control_id);
      }

      if (groupedRisks.size > 0) {
        doc.addPage();
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(15, 41, 74);
        doc.text("Appendix: Risk Register & Compensating Controls", margin, 42);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text(
          `Risk Owner: ${meta.owner || "--"} | Last Reviewed: ${meta.last_reviewed || "--"} | Review Cycle: ${meta.review_cycle || "Quarterly"}`,
          margin,
          56
        );

        const riskBody = Array.from(groupedRisks.values()).map((item) => [
          item.check_id,
          String(item.gov.decision || "").replace("_", " "),
          `${item.gov.category || ""}\nControls: ${Array.from(item.controls).sort().join(", ")}`,
          item.gov.rationale || "",
          item.gov.compensating_control || ""
        ]);

        doc.autoTable({
          startY: 66,
          margin: { left: margin, right: margin, bottom: 34 },
          head: [["Check ID", "Decision", "Category & Controls", "Rationale", "Compensating Control"]],
          body: riskBody,
          theme: "grid",
          styles: { fontSize: 7.5, cellPadding: 5, textColor: [15, 23, 42], overflow: "linebreak", valign: "top" },
          headStyles: { fillColor: [29, 78, 216], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: {
            0: { cellWidth: 140, fontStyle: "bold" },
            1: { cellWidth: 78, halign: "center", fontStyle: "bold" },
            2: { cellWidth: 122 },
            3: { cellWidth: (contentW - 340) / 2 },
            4: { cellWidth: (contentW - 340) / 2 }
          },
          didParseCell: (data) => {
            if (data.section === "body" && data.column.index === 1) {
              const key = String(data.cell.raw || "").replace(/ /g, "_").toUpperCase();
              const pal = statusPalette[key];
              if (pal) {
                data.cell.styles.fillColor = pal.fill;
                data.cell.styles.textColor = pal.text;
              }
            }
          }
        });
      }

      // Page Footers
      const totalPages = doc.internal.getNumberOfPages();
      const exportDate = new Date().toISOString().slice(0, 10);
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, pageH - 28, pageW - margin, pageH - 28);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`${latest.project || "Project Watchtower"} - ISO/IEC 27001:2022 Audit Export (${exportDate})`, margin, pageH - 16);
        doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 16, { align: "right" });
      }

      doc.save(`watchtower-iso27001-audit-report-${exportDate}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      alert(`PDF generation error (${err.message}). Opening browser print dialog instead.`);
      window.print();
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      });
    });

    document.getElementById("searchInput").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderFindingsTable();
    });

    document.getElementById("domainFilter").addEventListener("change", (e) => {
      state.domainFilter = e.target.value;
      renderFindingsTable();
    });

    document.querySelectorAll("#statusPills .pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        document.querySelectorAll("#statusPills .pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        state.statusFilter = pill.dataset.status;
        renderFindingsTable();
      });
    });

    document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
    document.getElementById("exportPdfBtn").addEventListener("click", exportPdf);
    document.getElementById("printReportBtn").addEventListener("click", () => window.print());
  }

  async function init() {
    bindEvents();
    const bust = `?t=${Date.now()}`;
    try {
      const [latestRes, historyRes] = await Promise.all([
        fetch(`./data/latest.json${bust}`),
        fetch(`./data/history.json${bust}`)
      ]);
      if (!latestRes.ok || !historyRes.ok) {
        throw new Error(`HTTP ${latestRes.status}/${historyRes.status} while loading telemetry JSON.`);
      }
      state.latest = await latestRes.json();
      state.history = await historyRes.json();

      renderHeader(state.latest);
      renderKpis(state.latest, state.history);
      renderTrendChart(state.history);
      renderDomainChart(state.latest.domains || []);
      populateDomains(state.latest.domains || []);
      renderFindingsTable();
      renderRiskRegister(state.latest);
    } catch (err) {
      const banner = document.getElementById("errorBanner");
      banner.textContent = `Unable to load telemetry JSON (${err.message}). Serve the dashboard folder over HTTP (e.g., python -m http.server 8000 --directory dashboard).`;
      banner.classList.remove("hidden");
    }
  }

  init();
})();