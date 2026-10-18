variable "project_id" { type = string }

# One service account per agent. The roles enforce separation of duties: only the
# Defender can change the project, and even it is gated behind a human approval event.
# These are the accounts the agents RUN AS; the attack targets (ci-deployer, org-admin)
# are planted by the seed module, not here.

# --- Recon: read-only inventory of IAM, compute, storage ---
resource "google_service_account" "recon" {
  project      = var.project_id
  account_id   = "recon-agent"
  display_name = "Recon (read-only inventory)"
}

resource "google_project_iam_member" "recon" {
  for_each = toset([
    "roles/viewer",               # list/get across compute, storage, resourcemanager
    "roles/iam.securityReviewer", # read IAM policies and SA keys metadata
    "roles/datastore.user",       # write graph/current + recon.complete event
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.recon.email}"
}

# --- Attacker: no GCP access at all; reasons over the Firestore graph only ---
resource "google_service_account" "attacker" {
  project      = var.project_id
  account_id   = "attacker-agent"
  display_name = "Attacker (Firestore graph only, no GCP)"
}

resource "google_project_iam_member" "attacker" {
  # datastore.user so it can read the graph and append attacker.claim events. Nothing else.
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.attacker.email}"
}

# --- Referee: same read scope as Recon, plus Connectivity Tests for network edges ---
resource "google_service_account" "referee" {
  project      = var.project_id
  account_id   = "referee-agent"
  display_name = "Referee (read-only verification)"
}

resource "google_project_iam_member" "referee" {
  for_each = toset([
    "roles/viewer",
    "roles/iam.securityReviewer",    # IAM reads + Policy Troubleshooter (policytroubleshooter.troubleshoot)
    "roles/networkmanagement.admin", # create/run Connectivity Tests
    "roles/datastore.user",          # write referee.verified / referee.rejected events
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.referee.email}"
}

# --- Defender: the only writer. Narrow write, this project only, gated by approval. ---
resource "google_service_account" "defender" {
  project      = var.project_id
  account_id   = "defender-agent"
  display_name = "Defender (scoped write, HITL-gated)"
}

resource "google_project_iam_member" "defender" {
  for_each = toset([
    "roles/iam.securityAdmin",     # remove/alter IAM bindings to close escalation paths
    "roles/storage.admin",         # fix public bucket IAM
    "roles/compute.securityAdmin", # fix firewall rules
    "roles/datastore.user",        # write defender.proposed / approval.requested / defender.applied
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.defender.email}"
}

output "service_account_emails" {
  value = {
    recon    = google_service_account.recon.email
    attacker = google_service_account.attacker.email
    referee  = google_service_account.referee.email
    defender = google_service_account.defender.email
  }
}
