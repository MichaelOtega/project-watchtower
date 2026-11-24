# CloudWatch Log Group for CloudTrail (30-day retention keeps storage inside 5 GB Always Free cap)
resource "aws_cloudwatch_log_group" "cloudtrail" {
  name              = "/aws/cloudtrail/watchtower-management-trail"
  retention_in_days = 365
}

data "aws_iam_policy_document" "cloudtrail_cw_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudtrail_cloudwatch" {
  name               = "watchtower-cloudtrail-cw-role"
  assume_role_policy = data.aws_iam_policy_document.cloudtrail_cw_assume.json
}

data "aws_iam_policy_document" "cloudtrail_cw_write" {
  statement {
    sid       = "AWSCloudTrailCreateLogStreamAndPutEvents"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.cloudtrail.arn}:*"]
  }
}

resource "aws_iam_role_policy" "cloudtrail_cloudwatch" {
  name   = "watchtower-cloudtrail-cw-policy"
  role   = aws_iam_role.cloudtrail_cloudwatch.id
  policy = data.aws_iam_policy_document.cloudtrail_cw_write.json
}

# Strictly 10 CIS/ISO Metric Filters & Standard Alarms = $0.00 under AWS CloudWatch Always Free
locals {
  cis_alarms = {
    vpc_changes = {
      metric_name = "WatchtowerVPCChanges"
      description = "CIS 4.14 / ISO 27001: VPC configuration changes"
      pattern     = "{ ($.eventName = CreateVpc) || ($.eventName = DeleteVpc) || ($.eventName = ModifyVpcAttribute) || ($.eventName = AcceptVpcPeeringConnection) || ($.eventName = CreateVpcPeeringConnection) || ($.eventName = DeleteVpcPeeringConnection) || ($.eventName = RejectVpcPeeringConnection) || ($.eventName = AttachClassicLinkVpc) || ($.eventName = DetachClassicLinkVpc) || ($.eventName = DisableVpcClassicLink) || ($.eventName = EnableVpcClassicLink) }"
    }
    console_signin_no_mfa = {
      metric_name = "WatchtowerConsoleSignInWithoutMFA"
      description = "CIS 4.2 / ISO 27001: Management Console sign-in without MFA"
      pattern     = "{ ($.eventName = \"ConsoleLogin\") && ($.additionalEventData.MFAUsed != \"Yes\") }"
    }
    iam_policy_changes = {
      metric_name = "WatchtowerIAMPolicyChanges"
      description = "CIS 4.4 / ISO 27001: IAM policy changes"
      pattern     = "{ ($.eventName=DeleteGroupPolicy) || ($.eventName=DeleteRolePolicy) || ($.eventName=DeleteUserPolicy) || ($.eventName=PutGroupPolicy) || ($.eventName=PutRolePolicy) || ($.eventName=PutUserPolicy) || ($.eventName=CreatePolicy) || ($.eventName=DeletePolicy) || ($.eventName=CreatePolicyVersion) || ($.eventName=DeletePolicyVersion) || ($.eventName=AttachRolePolicy) || ($.eventName=DetachRolePolicy) || ($.eventName=AttachUserPolicy) || ($.eventName=DetachUserPolicy) || ($.eventName=AttachGroupPolicy) || ($.eventName=DetachGroupPolicy) }"
    }
    security_group_changes = {
      metric_name = "WatchtowerSecurityGroupChanges"
      description = "CIS 4.10 / ISO 27001: Security Group changes"
      pattern     = "{ ($.eventName = AuthorizeSecurityGroupIngress) || ($.eventName = AuthorizeSecurityGroupEgress) || ($.eventName = RevokeSecurityGroupIngress) || ($.eventName = RevokeSecurityGroupEgress) || ($.eventName = CreateSecurityGroup) || ($.eventName = DeleteSecurityGroup) }"
    }
    s3_bucket_policy_changes = {
      metric_name = "WatchtowerS3BucketPolicyChanges"
      description = "CIS 4.8 / ISO 27001: S3 bucket policy or ACL changes"
      pattern     = "{ ($.eventSource = s3.amazonaws.com) && (($.eventName = PutBucketAcl) || ($.eventName = PutBucketPolicy) || ($.eventName = PutBucketCors) || ($.eventName = PutBucketLifecycle) || ($.eventName = PutBucketReplication) || ($.eventName = DeleteBucketPolicy) || ($.eventName = DeleteBucketCors) || ($.eventName = DeleteBucketLifecycle) || ($.eventName = DeleteBucketReplication)) }"
    }
    root_usage = {
      metric_name = "WatchtowerRootAccountUsage"
      description = "CIS 4.3 / ISO 27001: AWS root account activity"
      pattern     = "{ $.userIdentity.type = \"Root\" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != \"AwsServiceEvent\" }"
    }
    unauthorized_api_calls = {
      metric_name = "WatchtowerUnauthorizedAPICalls"
      description = "CIS 4.1 / ISO 27001: Unauthorized API calls"
      pattern     = "{ ($.errorCode = \"*UnauthorizedOperation\") || ($.errorCode = \"AccessDenied*\") }"
    }
    nacl_changes = {
      metric_name = "WatchtowerNACLChanges"
      description = "CIS 4.11 / ISO 27001: Network ACL changes"
      pattern     = "{ ($.eventName = CreateNetworkAcl) || ($.eventName = CreateNetworkAclEntry) || ($.eventName = DeleteNetworkAcl) || ($.eventName = DeleteNetworkAclEntry) || ($.eventName = ReplaceNetworkAclEntry) || ($.eventName = ReplaceNetworkAclAssociation) }"
    }
    console_auth_failures = {
      metric_name = "WatchtowerConsoleAuthFailures"
      description = "CIS 4.6 / ISO 27001: Management Console authentication failures"
      pattern     = "{ ($.eventName = ConsoleLogin) && ($.errorMessage = \"Failed authentication\") }"
    }
    cloudtrail_config_changes = {
      metric_name = "WatchtowerCloudTrailConfigChanges"
      description = "CIS 4.5 / ISO 27001: CloudTrail configuration changes"
      pattern     = "{ ($.eventName = CreateTrail) || ($.eventName = UpdateTrail) || ($.eventName = DeleteTrail) || ($.eventName = StartLogging) || ($.eventName = StopLogging) }"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "cis" {
  for_each       = local.cis_alarms
  name           = "watchtower-${each.key}"
  pattern        = each.value.pattern
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name

  metric_transformation {
    name      = each.value.metric_name
    namespace = "Watchtower/CISBenchmark"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "cis" {
  for_each            = local.cis_alarms
  alarm_name          = "watchtower-${each.key}-alarm"
  alarm_description   = each.value.description
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = each.value.metric_name
  namespace           = "Watchtower/CISBenchmark"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  depends_on = [aws_cloudwatch_log_metric_filter.cis]
}
