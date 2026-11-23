output "audit_vault_bucket_name" {
  description = "Hardened S3 bucket storing CloudTrail telemetry"
  value       = aws_s3_bucket.audit_vault.id
}

output "cloudtrail_arn" {
  description = "ARN of the multi-region management CloudTrail"
  value       = aws_cloudtrail.watchtower.arn
}

output "budget_name" {
  description = "Zero-cost AWS Budget guardrail name"
  value       = aws_budgets_budget.zero_cost_guardrail.name
}
