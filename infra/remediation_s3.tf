locals {
  tfstate_bucket_name = "watchtower-tfstate-${data.aws_caller_identity.current.account_id}-us-east-1"
}

# 1. Lifecycle rule on tfstate bucket (only expires old noncurrent versions; active state never expires)
resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = local.tfstate_bucket_name

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# 2. Dedicated S3 Server Access Logs sink bucket (prevents infinite self-logging loops)
resource "aws_s3_bucket" "access_logs" {
  bucket = "watchtower-access-logs-${data.aws_caller_identity.current.account_id}-us-east-1"
}

resource "aws_s3_bucket_ownership_controls" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket                  = aws_s3_bucket.access_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "expire-access-logs-90d"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "access_logs_policy" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [
      aws_s3_bucket.access_logs.arn,
      "${aws_s3_bucket.access_logs.arn}/*",
    ]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid     = "AllowS3ServerAccessLogDelivery"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    resources = ["${aws_s3_bucket.access_logs.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket     = aws_s3_bucket.access_logs.id
  policy     = data.aws_iam_policy_document.access_logs_policy.json
  depends_on = [aws_s3_bucket_public_access_block.access_logs]
}

# 3. Enable S3 Server Access Logging on both audit_vault and tfstate
resource "aws_s3_bucket_logging" "audit_vault" {
  bucket        = aws_s3_bucket.audit_vault.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "audit-vault/"
  depends_on    = [aws_s3_bucket_policy.access_logs]
}

resource "aws_s3_bucket_logging" "tfstate" {
  bucket        = local.tfstate_bucket_name
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "tfstate/"
  depends_on    = [aws_s3_bucket_policy.access_logs]
}
