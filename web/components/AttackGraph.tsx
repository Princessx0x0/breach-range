"use client";

import { useEffect, useRef } from "react";
import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
  type EdgeSingular,
} from "cytoscape";

import type { Graph } from "@/lib/firestore";

export type Phase = "idle" | "mapping" | "threat" | "verifying" | "secured";

/**
 * The hero. The graph is not a static picture — it performs each phase:
 *   mapping    nodes drop in one by one as Recon discovers them (cyan)
 *   threat     reachable edges flow with attack energy, nodes pulse (red)
 *   verifying  an amber scan sweeps the claimed path as the Referee checks it
 *   secured    the closed path flashes green and the graph goes dark (calm)
 * Motion tracks real state changes, never ambient decoration.
 */

const RELATION_PHRASE: Record<string, string> = {
  leaksKey: "leaks a key",
  tokenCreator: "can become",
  hasKey: "has a key",
  actAs: "can act as",
  hasRole: "has role",
  allowsIngress: "open to internet",
  readsBucket: "can read",
  writesBucket: "can write",
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function nodeState(reachable: boolean, fromMisconfig: string | null, rejected: boolean): string {
  if (reachable) return "reachable";
  if (rejected) return "rejected";
  if (fromMisconfig) return "patched";
  return "neutral";
}

function nodeLabel(n: Graph["nodes"][number]): string {
  const roles = (n.labels?.roles as string[] | undefined) ?? [];
  const owner = roles.includes("roles/owner") || roles.includes("roles/editor");
  if (n.kind === "bucket") {
    const short = n.name.replace(/^.*?-assets/, "assets");
    return `${short}\n${n.labels?.iamPublic ? "PUBLIC BUCKET" : "bucket"}`;
  }
  if (n.kind === "serviceAccount") {
    return `${n.name.split("@")[0]}\n${owner ? "OWNER" : "service account"}`;
  }
  return `${n.name}\n${n.kind}`;
}

function toElements(
  graph: Graph,
  rejectedNodeIds: Set<string>,
  rejectedEdgeIds: Set<string>,
): ElementDefinition[] {
  const reachable = new Set(graph.nodes.filter((n) => n.reachable).map((n) => n.id));
  const nodes = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      label: nodeLabel(n),
      state: nodeState(n.reachable, n.fromMisconfig, rejectedNodeIds.has(n.id)),
    },
  }));
  const edges = graph.edges.map((e) => {
    const lit = reachable.has(e.from) && reachable.has(e.to);
    const state = lit
      ? "reachable"
      : rejectedEdgeIds.has(e.id)
        ? "rejected"
        : e.viaMisconfig
          ? "patched"
          : "neutral";
    return {
      data: {
        id: e.id, source: e.from, target: e.to,
        label: RELATION_PHRASE[e.relation] ?? e.relation,
        state,
      },
    };
  });
  return [...nodes, ...edges];
}

export function AttackGraph({
  graph,
  phase,
  rejectedNodeIds,
  rejectedEdgeIds,
}: {
  graph: Graph | null;
  phase: Phase;
  rejectedNodeIds?: Set<string>;
  rejectedEdgeIds?: Set<string>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!boxRef.current || !graph) return;

    const reachable = cssVar("--reachable", "#ff3b5c");
    const patched = cssVar("--patched", "#22e39a");
    const neutral = cssVar("--neutral", "#495573");
    const rejected = cssVar("--rejected", "#9c6b78");
    const verify = cssVar("--verify", "#ffb020");
    const map = cssVar("--map", "#3ae1ff");
    const ink = cssVar("--ink", "#e9eefc");
    const inkMuted = cssVar("--ink-muted", "#8794b2");
    const surface = cssVar("--surface", "#0b1020");
    const color: Record<string, string> = { reachable, patched, neutral, rejected };
    const face = '"JetBrains Mono", ui-monospace, monospace';
    // Resting opacity per state: neutral and rejected sit back, live/closed read full.
    const restNodeOp = (s: string) => (s === "neutral" ? 0.5 : s === "rejected" ? 0.6 : 1);
    const restEdgeOp = (s: string) => (s === "neutral" ? 0.4 : s === "rejected" ? 0.5 : 1);
    const rejNodes = rejectedNodeIds ?? new Set<string>();
    const rejEdges = rejectedEdgeIds ?? new Set<string>();

    const cy = cytoscape({
      container: boxRef.current,
      elements: toElements(graph, rejNodes, rejEdges),
      style: [
        {
          selector: "node",
          style: {
            "background-color": (n: NodeSingular) => color[n.data("state")] ?? neutral,
            label: "data(label)",
            color: ink,
            "font-family": face,
            "font-size": "11px",
            "text-wrap": "wrap",
            "text-max-width": "140px",
            "text-valign": "bottom",
            "text-margin-y": 8,
            "text-outline-color": "#060a14",
            "text-outline-width": 2,
            width: 34,
            height: 34,
            "border-width": 2,
            "border-color": "#060a14",
            opacity: (n: NodeSingular) => restNodeOp(n.data("state")),
          },
        },
        {
          // Reachable nodes run larger with a stronger glow -- the compromised resources
          // should dominate the board.
          selector: 'node[state = "reachable"]',
          style: { "underlay-color": reachable, "underlay-opacity": 0.35, "underlay-padding": 10, width: 42, height: 42 },
        },
        {
          selector: 'node[state = "patched"]',
          style: { "underlay-color": patched, "underlay-opacity": 0.22, "underlay-padding": 6 },
        },
        {
          // Rejected: a dashed, muted ring -- claimed by the Attacker, thrown out by the Referee.
          selector: 'node[state = "rejected"]',
          style: {
            "border-style": "dashed",
            "border-color": rejected,
            "underlay-color": rejected,
            "underlay-opacity": 0.15,
            "underlay-padding": 6,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2.5,
            "line-color": (e: EdgeSingular) => color[e.data("state")] ?? neutral,
            "target-arrow-color": (e: EdgeSingular) => color[e.data("state")] ?? neutral,
            "target-arrow-shape": "triangle",
            "arrow-scale": 1.1,
            "curve-style": "bezier",
            label: "data(label)",
            "font-family": face,
            "font-size": "10px",
            color: inkMuted,
            "text-background-color": surface,
            "text-background-opacity": 0.9,
            "text-background-padding": "3px",
            opacity: (e: EdgeSingular) => restEdgeOp(e.data("state")),
          },
        },
        {
          // Live attack edge: a short bright dash on a long gap reads as a packet
          // travelling the edge when the dash offset animates (see the tick loop).
          selector: "edge.hot",
          style: { "line-style": "dashed", "line-dash-pattern": [5, 15], "line-color": reachable, "target-arrow-color": reachable, width: 3.5 },
        },
        {
          // Rejected edge: dashed and muted, visibly not part of the live red attack path.
          selector: 'edge[state = "rejected"]',
          style: { "line-style": "dashed", "line-color": rejected, "target-arrow-color": rejected },
        },
      ],
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.5, padding: 28, animate: true, animationDuration: 500 },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });
    cyRef.current = cy;

    const hot = cy.elements('[state = "reachable"]');
    cy.edges('[state = "reachable"]').addClass("hot");
    cy.nodes('[state = "reachable"]').addClass("hot");

    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;

    // Entrance: dramatic staggered build while mapping, a quick fade otherwise.
    const stagger = phase === "mapping" || phase === "idle";
    cy.nodes().style("opacity", 0);
    cy.edges().style("opacity", 0);
    cy.nodes().forEach((n, i) => {
      timers.push(setTimeout(() => {
        n.animate({ style: { opacity: restNodeOp(n.data("state")) } }, { duration: 260 });
      }, stagger ? i * 180 : i * 30));
    });
    timers.push(setTimeout(() => {
      cy.edges().forEach((e, i) => {
        timers.push(setTimeout(() => {
          e.animate({ style: { opacity: restEdgeOp(e.data("state")) } }, { duration: 240 });
        }, stagger ? i * 180 : i * 40));
      });
    }, stagger ? cy.nodes().length * 180 : 120));

    // The decoy beat: a rejected path first flashes like a live threat (red), then is
    // struck out -- it fades to a muted, dashed state as the Referee throws out a claim
    // that failed against ground truth. Mirrors a real state change, never decoration.
    const rej = cy.elements('[state = "rejected"]');
    if (rej.length > 0) {
      rej.edges().style({ "line-color": reachable, "target-arrow-color": reachable });
      rej.nodes().style({ "underlay-color": reachable, "underlay-opacity": 0.45, "underlay-padding": 12 });
      timers.push(
        setTimeout(() => {
          rej.edges().animate(
            { style: { "line-color": rejected, "target-arrow-color": rejected, opacity: restEdgeOp("rejected") } },
            { duration: 650 },
          );
          rej.nodes().animate(
            { style: { "underlay-color": rejected, "underlay-opacity": 0.15, opacity: restNodeOp("rejected") } },
            { duration: 650 },
          );
        }, 500),
      );
    }

    // Verifying: an amber scan sweeps the reachable nodes, then settles back to red.
    if (phase === "verifying") {
      cy.nodes(".hot").forEach((n, i) => {
        timers.push(setTimeout(() => {
          n.style({ "underlay-color": verify, "underlay-opacity": 0.6, "underlay-padding": 14 });
          timers.push(setTimeout(() => n.style({ "underlay-color": reachable }), 420));
        }, 300 + i * 220));
      });
    }

    // Secured: the closed path flashes green and the whole graph dims to dark.
    if (phase === "secured") {
      cy.edges().forEach((e) => {
        e.animate({ style: { "line-color": patched, "target-arrow-color": patched, width: 4 } }, { duration: 260 });
      });
      timers.push(setTimeout(() => {
        cy.elements().animate({ style: { opacity: 0.28 } }, { duration: 700 });
      }, 420));
    }

    // Ambient pulse + flow whenever an attack path is live (and not during the secured calm).
    if (hot.length > 0 && phase !== "secured") {
      const flowColor = phase === "verifying" ? verify : reachable;
      cy.edges(".hot").style({ "line-color": flowColor, "target-arrow-color": flowColor });
      let off = 0;
      const tick = () => {
        off -= 1.8; // faster: the packet dashes stream briskly along live edges
        cy.edges(".hot").style("line-dash-offset", off);
        const t = performance.now() / 520;
        cy.nodes(".hot").style({
          "underlay-padding": 12 + (Math.sin(t) + 1) * 6,
          "underlay-opacity": 0.3 + (Math.sin(t) + 1) * 0.18,
        });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      timers.forEach(clearTimeout);
      if (raf) cancelAnimationFrame(raf);
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, phase, rejectedNodeIds, rejectedEdgeIds]);

  const PHASE_LABEL: Record<Phase, string> = {
    idle: "standby",
    mapping: "mapping the project",
    threat: "attack path live",
    verifying: "verifying",
    secured: "secured",
  };

  return (
    <section className="panel graph" aria-label="Attack graph">
      <div className="panel__head">
        <h2 className="panel__title">Attack graph</h2>
        <span className="type-caption">
          {graph ? `round ${graph.round} · ${PHASE_LABEL[phase]}` : "awaiting recon"}
        </span>
      </div>
      {graph ? (
        <div ref={boxRef} className="graph__canvas" role="img" aria-label="Resource graph" />
      ) : (
        <div className="graph__empty">RUN RECON TO MAP THE PROJECT</div>
      )}
      <ul className="legend" aria-label="Legend">
        <li className="legend__item"><span className="legend__swatch legend__swatch--reachable" /><span className="legend__label">reachable</span></li>
        <li className="legend__item"><span className="legend__swatch legend__swatch--patched" /><span className="legend__label">closed</span></li>
        <li className="legend__item"><span className="legend__swatch legend__swatch--rejected" /><span className="legend__label">rejected</span></li>
        <li className="legend__item"><span className="legend__swatch legend__swatch--neutral" /><span className="legend__label">neutral</span></li>
      </ul>
    </section>
  );
}
