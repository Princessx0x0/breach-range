terraform {
  required_version = ">= 1.13"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  backend "gcs" {
    bucket = "breach-range-1031-tfstate"
    prefix = "sandbox"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Per-agent service accounts and their scoped roles (separation of duties).
module "iam" {
  source     = "./iam"
  project_id = var.project_id
}

# The seeded misconfigurations the Attacker reasons over and the Defender patches.
module "seed" {
  source     = "./seed"
  project_id = var.project_id
  region     = var.region
  seed_level = var.seed_level
}
