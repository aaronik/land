terraform {
  required_version = ">= 1.8.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the preview KV namespace and Worker"
  type        = string
}

provider "cloudflare" {}

# Worker code, bindings and workers.dev endpoint are deployed with `cf deploy`.
# Do not also manage the Worker with OpenTofu: that would create competing owners.
resource "cloudflare_workers_kv_namespace" "previews" {
  account_id = var.cloudflare_account_id
  title      = "shasta-land-atlas-previews"
}

output "preview_kv_id" {
  value       = cloudflare_workers_kv_namespace.previews.id
  description = "Set PREVIEW_KV_ID to this value before running npm run release"
}
