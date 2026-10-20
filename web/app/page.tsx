"use client";

import { useEffect, useState } from "react";

import { AttackGraph } from "@/components/AttackGraph";
import { ApprovalCard } from "@/components/ApprovalCard";
import { EventFeed } from "@/components/EventFeed";
import { PatchDiff } from "@/components/PatchDiff";
import { Scoreboard } from "@/components/Scoreboard";
import { StepControls } from "@/components/StepControls";
import {
  watchEvents,
  watchGraph,
  watchRounds,
  type EventDoc,
  type Graph,
  type Round,
} from "@/lib/firestore";

/**
 * The control room. Everything on screen is driven by Firestore real-time listeners --
 * the graph, the score, the feed, the patch and the approval state all move on their
 * own as the agents write. The only outbound actions are the approval click and the
 * step trigger. If the agent bridge is down, these panels still update.
 */
export default function ControlRoom() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
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

  return (
    <main className="room">
      <header className="room__head">
        <div>
          <h1 className="room__title">Breach &amp; Patch Range</h1>
          <p className="type-caption">
            Recon, Attacker, Referee, Defender — the game ends when nothing is reachable.
          </p>
        </div>
        <StepControls round={graph?.round ?? 1} />
      </header>

      {configError && (
        <p className="panel" role="alert" style={{ color: "var(--danger)" }}>
          {configError}
        </p>
      )}

      <div className="room__grid">
        <AttackGraph graph={graph} />
        <div className="room__rail">
          <Scoreboard graph={graph} rounds={rounds} />
          <ApprovalCard events={events} />
          <PatchDiff events={events} />
          <EventFeed events={events} />
        </div>
      </div>
    </main>
  );
}
