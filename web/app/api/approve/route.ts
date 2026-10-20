import { NextResponse } from "next/server";

import { adminFirestore, FieldValue } from "@/lib/firebaseAdmin";

/**
 * The human-in-the-loop approval gate. A reviewer clicks approve in ApprovalCard; this
 * route appends an `approval.granted` event to the log. That event is the authorisation
 * the Defender's tools/terraform.py checks for before it applies anything -- the gate is
 * enforced in the agent, this route only records the human's decision.
 *
 * Writing to Firestore (not the agent stream) keeps approval on the same durable source
 * of truth as everything else, so it survives a flaky agent bridge.
 */
export async function POST(req: Request) {
  let body: { round?: number; target?: string; approver?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { round, target, approver } = body;
  if (typeof round !== "number" || typeof target !== "string" || !target.startsWith("path:")) {
    return NextResponse.json(
      { error: "round (number) and target ('path:<id>') are required" },
      { status: 400 },
    );
  }

  try {
    const db = adminFirestore();

    // Refuse to approve something that was never proposed for this target.
    const proposed = await db
      .collection("events")
      .where("action", "==", "approval.requested")
      .where("target", "==", target)
      .limit(1)
      .get();
    if (proposed.empty) {
      return NextResponse.json(
        { error: `no approval.requested exists for ${target}` },
        { status: 409 },
      );
    }

    await db.collection("events").add({
      round,
      agent: "defender",
      action: "approval.granted",
      target,
      status: "applied",
      payload: { approver: approver ?? "human" },
      result: `approved by ${approver ?? "human"}`,
      ts: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "approval failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
