import { NextResponse } from "next/server";

/**
 * Step mode: advance the loop by one agent (or run to the end of a round). Forwards to
 * the deployed ADK agent at AGENT_URL; the agent does the work and writes to Firestore,
 * which the dashboard is already listening to. This is the one control that needs the
 * live backend -- the read path (graph, score, feed) does not.
 *
 * Kept thin on purpose: no graph data flows back through here, only a trigger. If
 * AGENT_URL is unset we say so clearly rather than pretend to step.
 */
export async function POST(req: Request) {
  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) {
    return NextResponse.json(
      { error: "AGENT_URL is not set; step mode needs the deployed agent." },
      { status: 503 },
    );
  }

  let body: { mode?: "step" | "round" | "auto"; round?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const res = await fetch(agentUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: body.mode ?? "step", round: body.round ?? 1 }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `agent returned ${res.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "could not reach the agent";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
