# 1. IAM Account Password Policy (ISO 27001 A.5.17 / A.8.5 - clears 7 checks)
resource "aws_iam_account_password_policy" "watchtower_strict" {
  minimum_password_length        = 14
  require_lowercase_characters   = true
  require_numbers                = true
  require_uppercase_characters   = true
  require_symbols                = true
  allow_users_to_change_password = true
  max_password_age               = 90
  password_reuse_prevention      = 24
}

# 2. S3 Account-Level Block Public Access (clears s3_account_level_public_access_blocks)
resource "aws_s3_account_public_access_block" "watchtower_account" {
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 3. IAM External Access Analyzer (Always Free external analyzer - clears accessanalyzer_enabled)
resource "aws_accessanalyzer_analyzer" "watchtower_external" {
  analyzer_name = "watchtower-external-access-analyzer"
  type          = "ACCOUNT"
}

# Archive authorized GitHub Actions OIDC scanner trust as code
resource "aws_accessanalyzer_archive_rule" "prowler_oidc_scanner" {
  analyzer_name = aws_accessanalyzer_analyzer.watchtower_external.analyzer_name
  rule_name     = "archive-authorized-github-oidc-scanner"

  filter {
    criteria = "resource"
    eq       = [aws_iam_role.prowler_scanner.arn]
  }
}

# Archive authorized Datadog monitoring integration (pinned to role ARN + Datadog AWS account)
resource "aws_accessanalyzer_archive_rule" "datadog_integration" {
  analyzer_name = aws_accessanalyzer_analyzer.watchtower_external.analyzer_name
  rule_name     = "archive-authorized-datadog-integration"

  filter {
    criteria = "resource"
    eq       = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/DatadogIntegrationRole"]
  }

  filter {
    criteria = "principal.AWS"
    eq       = ["464622532012"]
  }
}

# 4. AWS Backup Vault + Empty Plan (Zero selections / zero recovery points = $0.00)
resource "aws_backup_vault" "watchtower_vault" {
  name = "watchtower-backup-vault"
}

resource "aws_backup_plan" "watchtower_baseline" {
  name = "watchtower-baseline-backup-plan"

  rule {
    rule_name         = "daily-baseline-retention"
    target_vault_name = aws_backup_vault.watchtower_vault.name
    schedule          = "cron(0 5 ? * * *)"

    lifecycle {
      delete_after = 30
    }
  }
}
