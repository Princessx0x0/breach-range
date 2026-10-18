Multi-Agent Hackathon Strategy — Breach & Patch Range
Oct 18, 2026 · @Princess
A cloud-security multi-agent system for the 31 Oct hackathon: an autonomous attacker finds privilege-escalation paths in a GCP project, a defender patches them round by round, and a referee keeps honest score. Built on ADK + Agent Runtime + CopilotKit.
Concept & win condition
Four agents play a security game on a deliberately misconfigured GCP project. An attacker finds privilege-escalation paths, a defender patches them, and an independent referee keeps honest score, round after round, until nothing is reachable.
The attacker never runs a real exploit. It reasons over configuration: IAM policies, firewall rules, bucket permissions, service-account keys. It chains allow-relationships into paths, for example public bucket leaks a key, key has token-creator on a privileged account, escalate to owner. Every claimed path is proved by a read-only check, so the demo is safe and repeatable.
The one number that proves it works: reachable misconfigurations per round, scored by the referee, falling to zero. The attacker cannot grade its own work; only the referee confirms a path, and it confirms by re-reading ground truth, not by trusting the attacker. When the score drops, it is because a separate agent went back to the GCP config and could no longer get through. That independence is the whole proof, and judges trust it on sight.
Why this wins the room: it is not another chatbot, it uses her PCNE and PCNSE edge that nobody else will have, and the core beat is visual: an attack graph going dark as the defender closes paths.
System architecture
The loop is an ADK LoopAgent on Agent Runtime, running four agents in a fixed order until the referee reports nothing reachable. Deterministic workflow agents, not LLM routing, so the demo runs the same way every time, which matters when judges are watching. The agents write to Firestore; the dashboard reads Firestore; the loop reads and patches the sandbox only through scoped tools.
Recon and the Referee hold read-only tools; the Defender alone can write, and only through the human-approved Terraform step. The frontend's one direct link to the agents is the approval click, kept off the data path on purpose.
The integration decision
This is the one choice that can cost days if made late. Vertex AI Agent Engine (now branded Agent Runtime) exposes a REST streamQuery endpoint, with server-sent events when you add alt=sse. CopilotKit speaks the AG-UI protocol. There is no official bridge, and developers are getting stuck in adapter translation between the two in production.
Design around it with one rule: the dashboard's source of truth is Firestore, not the agent's stream. The agents write the graph and the event log to Firestore; the dashboard reads Firestore through real-time listeners. The agent transport never carries the graph. If the AG-UI bridge is flaky mid-demo, the graph and scoreboard still move, because nothing load-bearing depends on the fragile link.
That leaves CopilotKit for what it is genuinely good at here, which is not chat:
1. Generative UI renders agent state, progress and tool calls as live components, so the attack graph and the Terraform diff appear as the agent works.
2. Shared State keeps the dashboard and the agent in sync in both directions.
3. Human-in-the-Loop gates the defender: it cannot apply a patch until a human approves it. This is the governance control and the best demo beat in one.
Two ways to wire the live path, pick by time left:
• Option A, simplest. Host the ADK Runner directly behind the CopilotKit AG-UI endpoint on Cloud Run. The JS adapter @ag-ui/adk-js is built for exactly this and reports multi-agent handoffs as AG-UI step events. You skip Agent Engine on the live path.
• Option B, matches the "leverage the platform" ask. Deploy the agent to Agent Runtime for the governed, managed artifact, and put a thin AG-UI proxy on Cloud Run that calls its streamQuery endpoint and translates events.
Recommendation: build and deploy to Agent Runtime so the governance and managed-runtime story is real, but drive the live dashboard from Firestore plus Option A's direct Runner for the interactive approval step. You get the platform credit without betting the demo on the fragile bridge. Decide this today, not on day ten.
State backbone & live dashboard
One shared source of truth that everything reads and writes, and the dashboard just renders it live. Firestore, because its real-time listeners update the dashboard with no polling and it fits the Cloud Run stack.
Two collections:
• graph/current holds the live attack graph: nodes (resources), edges (allow-relationships), each node flagged reachable or not, and which seeded misconfiguration it came from.
• events is append-only. Every agent action writes one row: round, agent, action, target, claim or result, timestamp. Nothing lives secretly in an agent's head; if it happened, it is a row. This log is also the audit artifact after the demo.
The round loop as state transitions:
1. Recon reads the project, writes graph/current, logs recon.complete.
2. Attacker reads the graph, chains allow-edges to maximise reachable misconfigs, writes each path as attacker.claim and marks nodes reachable.
3. Referee independently re-reads ground truth, confirms each path with a read-only check (Connectivity Tests for network edges, Policy Analyzer for IAM), writes referee.verified or referee.rejected. Score equals verified-reachable misconfigs.
4. Defender picks the highest-impact path, writes a Terraform patch, applies on approval, logs defender.patch with the diff.
5. Back to Recon. New round. The graph shrinks.
Four dashboard panels:
• Attack graph, centre and the star: nodes and edges, reachable ones glowing, going dark as rounds progress. Cytoscape.js or D3.
• Scoreboard: reachable-misconfig count per round, a descending line. One number that tells the whole story.
• Live event feed: the events log streaming in, colour-coded by agent. This is where "real time" is felt.
• Patch diff: the current round's Terraform change, so judges see the defender do something concrete.
Build a step mode. A button that advances one agent at a time, so you narrate each step and the panels update on click. Full auto is the fallback. This single feature is the difference between a demo that lands and one that blurs past.
Governance
Governance is not a slide here, it is baked into the IAM. Each agent gets its own service account, and the permissions enforce separation of duties: only one agent can change anything, and even it is gated behind a human.
Agent
Service account access
Can write?
Recon
Read-only: viewer plus specific get/list on IAM, firewall, buckets
No
Attacker
Reads the Firestore graph only, no GCP access
No
Referee
Read-only, same scope as Recon, plus Connectivity Tests
No
Defender
Narrow write, scoped to the sandbox project only
Yes, after HITL approval
The controls that make it defensible:
• HITL approval gate. The defender proposes a Terraform patch; a human approves before apply. Nothing changes the project autonomously. This is the separation-of-duties control judges can see on screen.
• Throwaway sandbox project. No production data, its own new GCP project, a budget alert, and deletion after the event. The defender's service account is scoped to this project and nothing else.
• Audit trail, two layers. The append-only Firestore event log is the agents' own record. Cloud Audit Logs on the sandbox project independently prove the defender only did what it logged. Comparing the two is a clean integrity check.
• Attacker ignores deny by design. It reasons purely over allow-paths and never respects deny policies or VPC Service Controls. State this to judges as a deliberate modelling choice: it is safe because the attacker only ever reads, and it keeps the game honest by surfacing every path.
Talking points to have ready: least privilege per agent, VPC Service Controls as a perimeter the real system would add, and why an independent referee is the structural answer to an agent marking its own homework.
Optimization
ADK ships a built-in evaluation framework, and it turns "optimize" from a vague word into a measured result. You build evalsets of seeded scenarios with known ground-truth paths, run adk eval, and score each agent with LLM-as-judge. Then you tune prompts or models and show the score go up.
What to measure per agent:
• Attacker: path recall and precision. Did it find every real path, and did it claim any that are not there? Precision matters because the referee should catch over-claims, but fewer false claims is better reasoning.
• Referee: verification accuracy. Does it confirm the paths that are truly reachable and reject the ones that are not?
• Defender: fix minimality. Did it close the path without over-restricting and breaking a legitimate flow? Over-broad patches are the common failure, so this is the interesting score.
The demo gold is a before/after: baseline scores, then one tuning change, then improved scores on the same evalset. A measured improvement reads as engineering, not luck.
Latency and cost optimization, which doubles as a sophistication story:
1. Use ADK workflow agents for the loop, so routing spends no LLM tokens.
2. Cache the recon graph within a round instead of re-reading GCP on every agent call.
3. Tier the models: Gemini Flash for recon and referee, which are structured and high-volume; Gemini Pro for the attacker, where the reasoning is hard. Set location to global on every Gemini call, per the convention.
Model tiering alone is a real, defensible optimization you can state in one line and back with the eval numbers.
Frontend showcase
The frontend is a control room, not a chat window. Reuse Ije's design language so you are not inventing one under time pressure: deliberate typography, no border lines on cards, 8px spacing increments, no neon, no em dashes.
The technical build: Next.js on Cloud Run, CopilotKit for the agent-native pieces, Cytoscape.js for the graph. The graph is the hero element, so give it the most screen and the most motion.
The beats that win, in order of impact:
1. The graph going dark. Reachable nodes start lit; as the defender closes paths, they fade out round by round. This is the single image judges remember.
2. The HITL approval card. The defender's proposed Terraform patch appears, a human clicks approve, the patch applies and the graph updates. Separation of duties made visible.
3. The referee rejecting an over-claim. The attacker claims a path, the referee re-checks and rejects it live. This is what proves the scoring is honest, not theatre.
Colour carries meaning, so use it sparingly: one state for reachable, one for patched, one neutral. Avoid decorative colour that means nothing. Motion should track real state changes, never run as ambient animation.
Accessibility and polish for the last day: a legend for the graph colours, readable type at projector distance, and a title on each panel so a judge glancing mid-run knows what they are looking at.
The 13-day plan
Thirteen days, and the first week collides with Ije's final push before the bootcamp. The only way this fits is to reuse Ije's stack and design wholesale, so the hackathon build is new agents on a known foundation, not a new foundation.
Hold the rehearsal day on 30 Oct whatever happens; a system that works but has never been demoed end to end fails in the room. If you are behind by the 27th, cut rounds and seeded misconfigs, never the referee or the approval gate.
Risks & cut list
Risk
Why it bites
Mitigation
AG-UI / Agent Engine bridge
No official path, people lose days to it
Firestore is the dashboard's source of truth; bridge only drives the approval step
Live GCP read latency
Rounds stall waiting on API calls mid-demo
Step mode, cache the recon graph per round, pre-run once before the live demo
Ije collision
Ije and this are due within days of each other
Reuse Ije's stack and design wholesale; see the 13-day plan
Scope creep
Four agents plus a dashboard is a lot in 13 days
Hold the MVP line below, treat the rest as gravy
Over-broad defender patch
Breaks a legit flow, muddies the score
Referee checks fix minimality; keep seeded misconfigs simple
The MVP line, what must demo:
• Recon reads a sandbox project and builds the graph.
• Attacker finds at least two chained paths from seeded misconfigs.
• Referee verifies them with real read-only checks.
• Defender patches one path, with the HITL approval gate working.
• Dashboard shows the graph and the score moving across at least two rounds.
Gravy, only if time allows:
• The eval before/after numbers.
• Model tiering.
• The gray-box visibility parameter.
• More than three seeded misconfigs or more than three rounds.
If you hit the MVP line by day nine, everything after is upside. If you are behind, cut rounds and misconfigs before you cut the referee or the HITL gate, because those two are the whole point.
The demo
Judges score what they remember. Lead with the narrative, then let the system show it.
The four things they should leave with:
1. The attack graph going dark as paths close.
2. The HITL approval gate: a human approves a patch, autonomy with a brake.
3. The referee rejecting an over-claimed path, proving the score is honest.
4. The eval score improving after one tuning change, if you reach it.
Seed one beat on purpose. Plant a misconfiguration that looks exploitable but is not, so the referee rejects it live. A system that catches its own attacker's mistake is far more convincing than one that only ever succeeds.
The run order for a three-minute demo:
1. One line on the premise: four agents, a misconfigured project, a game that ends when nothing is reachable.
2. Show the starting graph lit up, name the score.
3. Step through round one: attacker claims, referee verifies and rejects the planted one, defender proposes, you approve.
4. Let the graph go dark over the next rounds, score falling to zero.
5. Close on governance and the eval numbers: separation of duties in the IAM, and a measured improvement.
Rehearse the step-mode path end to end at least twice before the event, and pre-run once so nothing is cold. Have a recorded fallback clip in case live GCP misbehaves.