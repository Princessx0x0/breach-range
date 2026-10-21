"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AttackGraph, type Phase } from "@/components/AttackGraph";
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
  type Path,
  type Round,
} from "@/lib/firestore";

/** The mood of the room, which drives the accent colour and the graph animation. */
function derivePhase(info: RunnerState | null, graph: Graph | null): Phase {
  if (!graph) return "idle";
  if (info?.status === "game_over") return "secured";
  const anyReachable = graph.nodes.some((n) => n.reachable);
  if (anyReachable) {
    // The Referee has just verified the attack (next step is the Defender): scrutiny.
    if (info?.next === "defender") return "verifying";
    return "threat";
  }
  return "mapping"; // graph is drawn but nothing is reachable yet
}

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
    async (action: "step" | "round" | "reset" | "teardown") => {
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

  const teardown = useCallback(() => {
    if (
      !window.confirm(
        "Tear down the sandbox? This destroys every resource in the project so nothing can bill. " +
          "Reset rebuilds it from scratch (takes about a minute).",
      )
    )
      return;
    void post("teardown");
  }, [post]);

  // The decoy beat. A path the Referee rejected (referee.rejected) was claimed by the
  // Attacker but failed against ground truth. We light its claimed-but-not-verified
  // nodes and edges as "rejected" so the graph shows it being thrown out, not quietly
  // reverting to neutral. Derived from the event log, so no schema change is needed.
  const rejected = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    if (!graph) return { nodeIds, edgeIds };
    const round = info?.round ?? graph.round;
    const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
    const reachable = new Set(graph.nodes.filter((n) => n.reachable).map((n) => n.id));

    // Edges/nodes on a verified path this round are the live attack: never mark them rejected.
    const verifiedEdges = new Set<string>();
    for (const ev of events) {
      if (ev.round !== round || ev.action !== "referee.verified") continue;
      ((ev.payload as { path?: Path }).path?.edges ?? []).forEach((id) => verifiedEdges.add(id));
    }
    for (const ev of events) {
      if (ev.round !== round || ev.action !== "referee.rejected") continue;
      const p = (ev.payload as { path?: Path }).path;
      if (!p) continue;
      const ids = [p.startNode];
      for (const eid of p.edges) {
        const e = edgeById.get(eid);
        if (e) ids.push(e.to);
        if (!verifiedEdges.has(eid)) edgeIds.add(eid);
      }
      ids.forEach((id) => {
        if (!reachable.has(id)) nodeIds.add(id);
      });
    }
    return { nodeIds, edgeIds };
  }, [events, graph, info]);

  const phase = derivePhase(info, graph);

  return (
    <main className="room" data-phase={phase}>
      <header className="room__head">
        <span className="room__brandmark" aria-hidden />
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
        phase={phase}
        busy={busy}
        onStep={() => post("step")}
        onRound={() => post("round")}
        onReset={() => post("reset")}
        onApprove={approve}
        onTeardown={teardown}
      />

      <div className="room__grid">
        <AttackGraph
          graph={graph}
          phase={phase}
          rejectedNodeIds={rejected.nodeIds}
          rejectedEdgeIds={rejected.edgeIds}
        />
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
