"""Project ids, model tiering, and location. One place to change deployment targets.

Convention: every Gemini call uses location 'global'. Model tiering: Flash for Recon and
Referee (structured, high-volume), Pro for the Attacker (hard reasoning) and Defender
(patch synthesis).
"""

import os

PROJECT_ID = os.environ.get("BREACH_RANGE_PROJECT", "breach-range-1031")
LOCATION = "global"

# Model tiering. Latest stable Flash and latest Pro in the 'global' location as of Oct 2026.
# gemini-2.5-pro is the stable fallback if the preview Pro misbehaves before the demo.
FLASH_MODEL = "gemini-3.8-flash"
PRO_MODEL = "gemini-3.1-pro-preview"

MODEL_BY_AGENT = {
    "recon": FLASH_MODEL,
    "attacker": PRO_MODEL,
    "referee": FLASH_MODEL,
    "defender": PRO_MODEL,
}

# Seed target resources (planted by sandbox/seed/misconfigs.tf). Recon reads these live;
# the ids here only help tag fromMisconfig/viaMisconfig deterministically.
CI_DEPLOYER_SA = f"ci-deployer@{PROJECT_ID}.iam.gserviceaccount.com"
ORG_ADMIN_SA = f"org-admin@{PROJECT_ID}.iam.gserviceaccount.com"
PUBLIC_BUCKET = f"{PROJECT_ID}-assets-public"


def ensure_vertex_env() -> None:
    """Point google-genai / ADK at Vertex in the right project and location."""
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", PROJECT_ID)
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", LOCATION)
