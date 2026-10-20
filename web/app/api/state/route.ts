import { NextResponse } from "next/server";

/**
 * The runner's view of the loop: what just happened and what the next step is. The status
 * banner reads this to narrate the game. Derived from the Firestore log, so it is correct
 * after a reload.
 */
const RUNNER = process.env.AGENT_URL;

export async function GET() {
  if (!RUNNER) {
    return NextResponse.json(
      { status: "error", message: "The runner is not configured (AGENT_URL unset)." },
      { status: 503 },
    );
  }
  try {
    const res = await fetch(`${RUNNER}/state`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch {
    return NextResponse.json(
      { status: "error", message: "Could not reach the runner. Is `python -m breach_range.control` running?" },
      { status: 502 },
    );
  }
}
