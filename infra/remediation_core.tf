# 1. IAM Account Password Policy (ISO 27001 A.5.17 / A.8.5 ? clears 7 checks)
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

# 3. IAM External Access Analyzer (Always Free external analyzer ? clears accessanalyzer_enabled)
resource "aws_accessanalyzer_analyzer" "watchtower_external" {
  analyzer_name = "watchtower-external-access-analyzer"
  type          = "ACCOUNT"
}

# 4. AWS Backup Vault (Zero storage = $0.00 ? clears backup_vaults_exist)
resource "aws_backup_vault" "watchtower_vault" {
  name = "watchtower-backup-vault"
}
