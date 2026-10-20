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

function nodeState(reachable: boolean, fromMisconfig: string | null): string {
  if (reachable) return "reachable";
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

function toElements(graph: Graph): ElementDefinition[] {
  const reachable = new Set(graph.nodes.filter((n) => n.reachable).map((n) => n.id));
  const nodes = graph.nodes.map((n) => ({
    data: { id: n.id, label: nodeLabel(n), state: nodeState(n.reachable, n.fromMisconfig) },
  }));
  const edges = graph.edges.map((e) => {
    const lit = reachable.has(e.from) && reachable.has(e.to);
    return {
      data: {
        id: e.id, source: e.from, target: e.to,
        label: RELATION_PHRASE[e.relation] ?? e.relation,
        state: lit ? "reachable" : e.viaMisconfig ? "patched" : "neutral",
      },
    };
  });
  return [...nodes, ...edges];
}

export function AttackGraph({ graph, phase }: { graph: Graph | null; phase: Phase }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!boxRef.current || !graph) return;

    const reachable = cssVar("--reachable", "#ff3b5c");
    const patched = cssVar("--patched", "#22e39a");
    const neutral = cssVar("--neutral", "#495573");
    const verify = cssVar("--verify", "#ffb020");
    const map = cssVar("--map", "#3ae1ff");
    const ink = cssVar("--ink", "#e9eefc");
    const inkMuted = cssVar("--ink-muted", "#8794b2");
    const surface = cssVar("--surface", "#0b1020");
    const color: Record<string, string> = { reachable, patched, neutral };
    const face = '"JetBrains Mono", ui-monospace, monospace';

    const cy = cytoscape({
      container: boxRef.current,
      elements: toElements(graph),
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
            opacity: (n: NodeSingular) => (n.data("state") === "neutral" ? 0.5 : 1),
          },
        },
        {
          selector: 'node[state = "reachable"]',
          style: { "underlay-color": reachable, "underlay-opacity": 0.3, "underlay-padding": 8 },
        },
        {
          selector: 'node[state = "patched"]',
          style: { "underlay-color": patched, "underlay-opacity": 0.22, "underlay-padding": 6 },
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
            opacity: (e: EdgeSingular) => (e.data("state") === "neutral" ? 0.4 : 1),
          },
        },
        {
          selector: "edge.hot",
          style: { "line-style": "dashed", "line-dash-pattern": [9, 7], "line-color": reachable, "target-arrow-color": reachable, width: 3 },
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
        n.animate({ style: { opacity: n.data("state") === "neutral" ? 0.5 : 1 } }, { duration: 260 });
      }, stagger ? i * 180 : i * 30));
    });
    timers.push(setTimeout(() => {
      cy.edges().forEach((e, i) => {
        timers.push(setTimeout(() => {
          e.animate({ style: { opacity: e.data("state") === "neutral" ? 0.4 : 1 } }, { duration: 240 });
        }, stagger ? i * 180 : i * 40));
      });
    }, stagger ? cy.nodes().length * 180 : 120));

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
        off -= 0.9;
        cy.edges(".hot").style("line-dash-offset", off);
        const t = performance.now() / 520;
        cy.nodes(".hot").style({
          "underlay-padding": 8 + (Math.sin(t) + 1) * 4,
          "underlay-opacity": 0.22 + (Math.sin(t) + 1) * 0.16,
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
  }, [graph, phase]);

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
        <li className="legend__item"><span className="legend__swatch legend__swatch--neutral" /><span className="legend__label">neutral</span></li>
      </ul>
    </section>
  );
}
