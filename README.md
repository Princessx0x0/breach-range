# Breach & Patch Range — repo scaffold

A monorepo: ADK agents in Python, a Next.js + CopilotKit dashboard, and the
Terraform that builds and tears down the throwaway sandbox. Hand each top-level
folder to Claude Code as a separate build task; they share only `firestore-schema.json`.

```
breach-range/
├── agents/                          # ADK multi-agent system (Python)
│   ├── breach_range/
│   │   ├── __init__.py
│   │   ├── agent.py                 # root LoopAgent: Recon → Attacker → Referee → Defender
│   │   ├── recon/agent.py           # reads config, writes graph/current
│   │   ├── attacker/agent.py        # chains allow-edges, writes attacker.claim
│   │   ├── referee/agent.py         # re-reads ground truth, verifies/rejects, sets score
│   │   ├── defender/agent.py        # proposes Terraform patch, waits for approval, applies
│   │   ├── tools/
│   │   │   ├── gcp_readonly.py       # IAM get-policy, firewall list, bucket IAM, Connectivity Tests
│   │   │   ├── terraform.py          # write tool — Defender only, HITL-gated
│   │   │   └── firestore_io.py       # the only module that touches Firestore
│   │   └── shared/
│   │       ├── schema.py             # dataclasses mirroring firestore-schema.json
│   │       └── config.py             # project ids, model tiers, LOCATION = "global"
│   ├── eval/
│   │   ├── evalsets/                 # seeded scenarios + ground-truth paths (adk eval)
│   │   └── scorers.py                # LLM-as-judge: path recall/precision, fix minimality
│   ├── pyproject.toml                # google-adk, google-cloud-agentplatform[adk]
│   └── deploy.sh                     # adk deploy agent_engine ... --region us-central1
│
├── web/                             # Next.js + CopilotKit dashboard (Cloud Run)
│   ├── app/
│   │   ├── api/copilotkit/route.ts   # AG-UI endpoint via @ag-ui/adk-js → ADK Runner
│   │   └── page.tsx                  # the control room
│   ├── components/
│   │   ├── AttackGraph.tsx           # Cytoscape; subscribes to graph/current
│   │   ├── Scoreboard.tsx            # reads rounds collection
│   │   ├── EventFeed.tsx             # streams events, colour-coded by agent
│   │   ├── PatchDiff.tsx             # renders defender.proposed payload
│   │   └── ApprovalCard.tsx          # CopilotKit HITL — the approval gate
│   ├── lib/firestore.ts              # real-time listeners (the read path)
│   └── Dockerfile
│
├── sandbox/                         # the throwaway target project
│   ├── seed/misconfigs.tf            # plants the seeded misconfigurations
│   ├── iam/service-accounts.tf       # per-agent SAs + scoped roles (see Governance)
│   └── teardown.sh                   # gcloud projects delete after the event
│
├── firestore-schema.json             # the data contract — shared, do not fork
├── ARCHITECTURE.md                   # export of the strategy doc
└── README.md
```

## Conventions (record these so Claude Code follows them)

- `firestore-schema.json` is the contract. `shared/schema.py` and `web/lib/firestore.ts`
  both conform to it. Change the JSON first, then both sides.
- Firestore is the dashboard's source of truth. The dashboard never reads the agent
  stream for graph data; it only uses CopilotKit for the approval action.
- Every Gemini call sets `location = "global"`.
- Model tiering: Flash for Recon and Referee (structured, high-volume), Pro for the
  Attacker (hard reasoning). Set per agent in `shared/config.py`.
- No mock data and no fake auth anywhere; the sandbox is a real GCP project.
- Dashboard design tokens from Ije: no border lines on cards, 8px spacing increments,
  deliberate typography, no neon, no em dashes.
- The Attacker reasons over allow-paths only and never respects deny policies or
  VPC Service Controls. This is deliberate and safe because it only reads.

## Seeded misconfigurations (the ground truth)

Keep it to 4–5, each tagged with an id the graph references via `fromMisconfig` /
`viaMisconfig`. Start with two that chain, so the Attacker has a real path day one.

| id | Misconfiguration | Enables |
| --- | --- | --- |
| MC-01 | Public Cloud Storage bucket holding a service-account key | Outsider reads a CI service-account key |
| MC-02 | CI service account has `roles/iam.serviceAccountTokenCreator` on an owner SA | Escalate from CI SA to owner |
| MC-03 | Firewall rule allows `0.0.0.0/0` on port 22 to a tagged VM | Direct ingress to an instance |
| MC-04 | VM's attached service account has a broad project role | Instance compromise reaches project resources |
| MC-05 | Decoy: looks exploitable, but a deny policy blocks the final step | The Referee rejects this live — the honesty beat |

MC-01 → MC-02 is the headline chain: public bucket leaks a key, key escalates to owner.
MC-05 is the planted path the Attacker claims and the Referee rejects on stage.

## Governance — service accounts (sandbox project only)

| Service account | Role scope | Writes? |
| --- | --- | --- |
| `recon@` | viewer + specific get/list on IAM, compute, storage | No |
| `attacker@` | none on GCP; Firestore graph read only | No |
| `referee@` | same read scope as recon + Connectivity Tests | No |
| `defender@` | narrow write, this project only, gated by approval event | Yes |

Budget alert on the project; `teardown.sh` deletes it after the event.

## Build order

1. `sandbox/` — plant MC-01 and MC-02, create the four service accounts.
2. `agents/` Recon + `firestore_io` — prove the graph appears in Firestore.
3. Attacker + Referee — claims and verification, score moves.
4. Defender + the approval gate.
5. `web/` — graph, scoreboard, event feed, approval card; step mode.
6. Everything after the MVP line: eval scorers, model tiering, the decoy MC-05.
