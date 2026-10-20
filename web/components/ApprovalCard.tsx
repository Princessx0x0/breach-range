"use client";

import { useState } from "react";

import type { EventDoc } from "@/lib/firestore";

/**
 * The human-in-the-loop gate, and the best demo beat: the Defender proposes, a human
 * approves, and only then does the patch apply. Approving POSTs to /api/approve, which
 * writes approval.granted; the Defender's own tool checks for that event before it
 * touches the sandbox. The agent never approves its own patch.
 */
function openRequest(events: EventDoc[]): EventDoc | null {
  const granted = new Set(
    events.filter((e) => e.action === "approval.granted").map((e) => e.target),
  );
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.action === "approval.requested" && !granted.has(e.target)) return e;
  }
  return null;
}

export function ApprovalCard({ events }: { events: EventDoc[] }) {
  const request = openRequest(events);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ round: request.round, target: request.target, approver: "operator" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `approval failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel approval" aria-label="Approval gate">
      <div className="panel__head">
        <h2 className="panel__title">Approval gate</h2>
      </div>
      {request ? (
        <>
          <p className="approval__target">
            {(request.result as string) ?? `Approve patch for ${request.target}?`}
          </p>
          <div className="approval__actions">
            <button className="button" onClick={approve} disabled={busy}>
              {busy ? "Applying…" : "Approve patch"}
            </button>
            <span className="approval__note">
              {request.target} · round {request.round}
            </span>
          </div>
          {error && <p className="approval__note" role="alert">{error}</p>}
        </>
      ) : (
        <p className="approval__note">No patch is waiting for approval.</p>
      )}
    </section>
  );
}
