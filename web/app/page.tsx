"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AttackGraph } from "@/components/AttackGraph";
import { EventFeed } from "@/components/EventFeed";
import { Explainer } from "@/components/Explainer";
import { PatchDiff } from "@/components/PatchDiff";
import { Scoreboard } from "@/components/Scoreboard";
import { StatusBanner, type RunnerState } from "@/components/StatusBanner";
import {
  watchEvents,
  watchGraph,
  watchRounds,
  type EventDoc,
  type Graph,
  type Round,
} from "@/lib/firestore";

/**
 * The control room, guided-story style. The status banner narrates the game and carries
 * the one button that advances it. Everything below is live detail read from Firestore:
 * the attack graph, the score, the proposed fix, the event log.
 */
export default function ControlRoom() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [info, setInfo] = useState<RunnerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const unsubs = [
        watchGraph(setGraph, (e) => setConfigError(e.message)),
        watchEvents(setEvents, (e) => setConfigError(e.message)),
        watchRounds(setRounds, (e) => setConfigError(e.message)),
      ];
      return () => unsubs.forEach((u) => u());
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "could not connect to Firestore");
    }
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      setInfo((await res.json()) as RunnerState);
    } catch {
      setInfo({
        round: 1, status: "error", next: "", nextLabel: "", stepIndex: 0, stepCount: 4,
        score: 0, target: null,
        message: "Could not reach the runner. Start it with: python -m breach_range.control",
      });
    }
  }, []);

  // Refresh the narration on load and whenever the agents write (events change).
  useEffect(() => { void refreshState(); }, [refreshState, events.length]);

  const post = useCallback(
    async (action: "step" | "round" | "reset") => {
      setBusy(true);
      try {
        const res = await fetch("/api/step", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        setInfo((await res.json()) as RunnerState);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const approve = useCallback(async () => {
    if (!info?.target) return;
    setBusy(true);
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ round: info.round, target: info.target, approver: "operator" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setInfo((prev) => (prev ? { ...prev, status: "error", message: data.error ?? "approval failed" } : prev));
        return;
      }
      // Approved: run the apply step the approval just unlocked.
      const stepRes = await fetch("/api/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "step" }),
      });
      setInfo((await stepRes.json()) as RunnerState);
    } finally {
      setBusy(false);
    }
  }, [info]);

  return (
    <main className="room">
      <header className="room__head">
        <div>
          <h1 className="room__title">Breach &amp; Patch Range</h1>
          <p className="type-caption">
            Four AI agents play attack and defend on a real throwaway cloud project.
          </p>
        </div>
      </header>

      {configError && (
        <p className="panel" role="alert" style={{ color: "var(--danger)" }}>
          {configError}
        </p>
      )}

      <StatusBanner
        info={info}
        busy={busy}
        onStep={() => post("step")}
        onRound={() => post("round")}
        onReset={() => post("reset")}
        onApprove={approve}
      />

      <div className="room__grid">
        <AttackGraph graph={graph} />
        <div className="room__rail">
          <Scoreboard graph={graph} rounds={rounds} />
          <Explainer />
          <PatchDiff events={events} />
          <EventFeed events={events} />
        </div>
      </div>
    </main>
  );
}
