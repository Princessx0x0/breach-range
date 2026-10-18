# Breach & Patch Range

Four ADK agents (Recon, Attacker, Referee, Defender) play attack/defend on a throwaway
GCP sandbox project. See `ARCHITECTURE.md` for the strategy and `README.md` for the layout,
seeded misconfigs and build order.

## Conventions

- `firestore-schema.json` is the contract. `agents/breach_range/shared/schema.py` and
  `web/lib/firestore.ts` both conform to it. Change the JSON first, then both sides.
  Where `ARCHITECTURE.md` disagrees with the schema (e.g. `defender.patch`), the schema wins.
- `agents/breach_range/tools/firestore_io.py` is the only module that touches Firestore.
- `events` is append-only. Never update or delete an event; corrections are new events.
- Only the Referee writes status `verified` / `rejected`. The Attacker only writes `claimed`.
- `defender.applied` is written only after an `approval.granted` event exists for the same
  target. Enforce this in `tools/terraform.py`, not in a prompt.
- Firestore is the dashboard's source of truth. The dashboard never reads the agent stream
  for graph data; CopilotKit is used only for step mode and the approval action.
- Every Gemini call sets `location = "global"`.
- Model tiering in `shared/config.py`: Flash for Recon and Referee, Pro for Attacker and Defender.
- No mock data and no fake auth anywhere; the sandbox is a real GCP project.
- The Attacker reasons over allow-paths only and never models deny policies or VPC-SC.
- The Referee verifies IAM edges with Policy Troubleshooter and network edges with
  Connectivity Tests, re-reading ground truth itself. It never trusts the Attacker's claim.
- Seeded resources carry the label `misconfig=mc-0N`; Recon tags `fromMisconfig` /
  `viaMisconfig` from that label, never by guessing.
- Safety: the MC-01 bucket object never contains private key material, and the CI SA
  key is disabled. The public bucket must not hand anyone a working path to owner.
- Dashboard design: no border lines on cards, 8px spacing increments, deliberate
  typography readable at projector distance, no neon, no em dashes in UI text. Colour
  only carries state: reachable, patched, neutral.
