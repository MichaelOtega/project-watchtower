resource "aws_cloudtrail" "watchtower" {
  name                          = "watchtower-management-trail"
  s3_bucket_name                = aws_s3_bucket.audit_vault.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true

  cloud_watch_logs_group_arn = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn  = aws_iam_role.cloudtrail_cloudwatch.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  depends_on = [
    aws_s3_bucket_policy.audit_vault,
    aws_iam_role_policy.cloudtrail_cloudwatch,
  ]
}
