variable "project_id" { type = string }
variable "region" { type = string }
variable "seed_level" { type = number }

# The seeded misconfigurations are the game's ground truth. Each is tagged so Recon can
# label graph nodes/edges deterministically (buckets carry a `misconfig` label; IAM edges
# are matched by pattern, since bindings cannot hold labels).
#
# Planted now: MC-01 and MC-02, the headline chain (public bucket leaks a CI key, the CI SA
# escalates to an owner SA). MC-03/04/05 are added later behind seed_level.
#
# SAFETY: the "leaked key" in the public bucket contains NO usable private key, and the real
# key created on the CI SA is disabled immediately. The escalation path is fully visible to
# the agents (real public-bucket IAM, a real key resource, a real tokenCreator binding) but
# cannot actually be walked by an outsider.

# ---------------------------------------------------------------------------
# MC-02 target accounts: the CI deployer SA and the privileged owner SA.
# (Defined first because MC-01's leaked-key object references the CI SA.)
# ---------------------------------------------------------------------------
resource "google_service_account" "ci_deployer" {
  project      = var.project_id
  account_id   = "ci-deployer"
  display_name = "CI deployer"
  description  = "[seed:mc-02] CI service account; over-privileged with tokenCreator on org-admin"
}

resource "google_service_account" "org_admin" {
  project      = var.project_id
  account_id   = "org-admin"
  display_name = "Org admin"
  description  = "[seed:mc-02] Privileged service account, the escalation target"
}

# org-admin holds a project-wide owner role: the prize at the end of the chain.
resource "google_project_iam_member" "org_admin_owner" {
  project = var.project_id
  role    = "roles/owner"
  member  = "serviceAccount:${google_service_account.org_admin.email}"
}

# MC-02: ci-deployer can mint tokens for org-admin. This is the escalation edge.
resource "google_service_account_iam_member" "ci_can_impersonate_owner" {
  service_account_id = google_service_account.org_admin.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.ci_deployer.email}"
}

# ---------------------------------------------------------------------------
# MC-01: a public bucket holding what looks like a CI service-account key.
# ---------------------------------------------------------------------------
resource "google_storage_bucket" "assets_public" {
  project                     = var.project_id
  name                        = "${var.project_id}-assets-public"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
  labels                      = { misconfig = "mc-01" }
}

# The misconfiguration: the bucket is world-readable.
resource "google_storage_bucket_iam_member" "assets_public_allusers" {
  bucket = google_storage_bucket.assets_public.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# A real key on the CI SA, so Recon sees a genuine key resource via the IAM API...
resource "google_service_account_key" "ci_key" {
  service_account_id = google_service_account.ci_deployer.name
}

# ...but it is disabled immediately, so the leaked path is inert.
resource "null_resource" "disable_ci_key" {
  triggers = { key = google_service_account_key.ci_key.name }
  provisioner "local-exec" {
    command = "gcloud iam service-accounts keys disable ${element(split("/", google_service_account_key.ci_key.name), length(split("/", google_service_account_key.ci_key.name)) - 1)} --iam-account=${google_service_account.ci_deployer.email} --project=${var.project_id} --quiet"
  }
}

# The object in the public bucket looks like a leaked key file but carries NO private key.
locals {
  leaked_key_file = jsonencode({
    type           = "service_account"
    project_id     = var.project_id
    private_key_id = element(split("/", google_service_account_key.ci_key.name), length(split("/", google_service_account_key.ci_key.name)) - 1)
    client_email   = google_service_account.ci_deployer.email
    token_uri      = "https://oauth2.googleapis.com/token"
    private_key    = "-----BEGIN PRIVATE KEY-----\nDISABLED-KEY-REDACTED-FOR-SAFETY\n-----END PRIVATE KEY-----\n"
  })
}

resource "google_storage_bucket_object" "leaked_key" {
  bucket  = google_storage_bucket.assets_public.name
  name    = "backups/ci-deployer-key.json"
  content = local.leaked_key_file
}

output "misconfigs" {
  value = {
    "MC-01" = "public bucket ${google_storage_bucket.assets_public.name} holds a (disabled) CI key"
    "MC-02" = "${google_service_account.ci_deployer.email} has tokenCreator on ${google_service_account.org_admin.email} (owner)"
  }
}
