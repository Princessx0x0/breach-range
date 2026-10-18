variable "project_id" {
  type        = string
  description = "The throwaway sandbox project id."
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "seed_level" {
  type        = number
  default     = 2
  description = "How many seeded misconfigs to plant: 2 = MC-01/MC-02 (the headline chain), up to 5 for the full set."

  validation {
    condition     = var.seed_level >= 2 && var.seed_level <= 5
    error_message = "seed_level must be between 2 and 5."
  }
}
