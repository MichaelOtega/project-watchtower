provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project    = "Project-Watchtower"
      ManagedBy  = "Terraform"
      Compliance = "ISO27001-2022"
      Owner      = "MichaelAdmin"
    }
  }
}
