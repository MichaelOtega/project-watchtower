data "aws_caller_identity" "dashboard_current" {}

locals {
  dashboard_bucket_name = "watchtower-cspm-dashboard-${data.aws_caller_identity.dashboard_current.account_id}"
  github_oidc_arn       = "arn:aws:iam::${data.aws_caller_identity.dashboard_current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

# 1. Private S3 Bucket for Static Dashboard Assets
resource "aws_s3_bucket" "dashboard" {
  bucket = local.dashboard_bucket_name
}

resource "aws_s3_bucket_public_access_block" "dashboard" {
  bucket                  = aws_s3_bucket.dashboard.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 2. CloudFront Origin Access Control (SigV4)
resource "aws_cloudfront_origin_access_control" "dashboard" {
  name                              = "watchtower-cspm-dashboard-oac"
  description                       = "OAC for private Watchtower CSPM S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# 3. CloudFront Distribution (HTTPS Enforced)
resource "aws_cloudfront_distribution" "dashboard" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  comment             = "Watchtower CSPM ISO/IEC 27001:2022 Portal"

  origin {
    domain_name              = aws_s3_bucket.dashboard.bucket_regional_domain_name
    origin_id                = "s3-watchtower-dashboard"
    origin_access_control_id = aws_cloudfront_origin_access_control.dashboard.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-watchtower-dashboard"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # AWS Managed-CachingOptimized Policy ID
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# 4. S3 Bucket Policy (CloudFront OAC Only + Enforce TLS)
data "aws_iam_policy_document" "dashboard_bucket_policy" {
  statement {
    sid       = "AllowCloudFrontOACRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.dashboard.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.dashboard.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.dashboard.arn, "${aws_s3_bucket.dashboard.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id
  policy = data.aws_iam_policy_document.dashboard_bucket_policy.json
}

# 5. Least-Privilege OIDC Deployer Role (Main Branch Only)
data "aws_iam_policy_document" "dashboard_deployer_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:MichaelOtega/project-watchtower:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "dashboard_deployer" {
  name               = "watchtower-dashboard-deployer"
  assume_role_policy = data.aws_iam_policy_document.dashboard_deployer_trust.json
}

resource "aws_iam_role_policy" "dashboard_deployer_perms" {
  name = "watchtower-dashboard-s3-cf-deploy"
  role = aws_iam_role.dashboard_deployer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.dashboard.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.dashboard.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.dashboard.arn
      }
    ]
  })
}

output "dashboard_bucket_name" {
  value = aws_s3_bucket.dashboard.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.dashboard.id
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.dashboard.domain_name}"
}

output "dashboard_deployer_role_arn" {
  value = aws_iam_role.dashboard_deployer.arn
}

