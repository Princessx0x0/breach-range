import { NextResponse } from "next/server";

/**
 * Drives the local runner (breach_range.control) that steps the agents. The runner does
 * the work and writes Firestore, which the dashboard is already listening to; this route
 * just forwards the trigger and returns the runner's narration (what just happened / what
 * is next) so the status banner can update immediately.
 */
const RUNNER = process.env.AGENT_URL;
const ACTIONS: Record<string, string> = { step: "/step", round: "/round", reset: "/reset" };

export async function POST(req: Request) {
  if (!RUNNER) {
    return NextResponse.json(
      { status: "error", message: "The runner is not configured (AGENT_URL unset)." },
      { status: 503 },
    );
  }
  let action = "step";
  try {
    const body = (await req.json()) as { action?: string };
    if (body.action && body.action in ACTIONS) action = body.action;
  } catch {
    /* default to step */
  }

  try {
    const res = await fetch(`${RUNNER}${ACTIONS[action]}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch {
    return NextResponse.json(
      { status: "error", message: "Could not reach the runner. Is `python -m breach_range.control` running?" },
      { status: 502 },
    );
  }
}
