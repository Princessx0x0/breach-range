"use client";

import { useState } from "react";

/**
 * Step mode: advance one agent at a time so the operator narrates each move and the
 * panels update on click. Full auto is the fallback. POSTs to /api/step, which triggers
 * the agent; everything the agent does flows back through Firestore to the panels.
 */
export function StepControls({ round }: { round: number }) {
  const [busy, setBusy] = useState<"step" | "round" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: "step" | "round") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, round }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `step failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "step failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="steps">
      <span className="steps__label">Step mode</span>
      <button className="button button--secondary" onClick={() => run("step")} disabled={busy !== null}>
        {busy === "step" ? "Stepping…" : "Next agent"}
      </button>
      <button className="button button--secondary" onClick={() => run("round")} disabled={busy !== null}>
        {busy === "round" ? "Running…" : "Run round"}
      </button>
      {error && <span className="approval__note" role="alert">{error}</span>}
    </div>
  );
}
