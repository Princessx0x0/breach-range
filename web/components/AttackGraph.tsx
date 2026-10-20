"use client";

import { useEffect, useRef } from "react";
import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
  type EdgeSingular,
} from "cytoscape";

import type { Graph } from "@/lib/firestore";

/**
 * The hero panel: the attack graph. Nodes are resources, edges are allow-relationships.
 * Colour carries one thing -- state:
 *   reachable            an outsider can walk here now           (lit, reachable red)
 *   closed misconfig     a seeded misconfig no longer reachable  (patched green)
 *   neutral              present but not reachable               (dark)
 * As the Defender closes paths, lit nodes fall to patched/neutral: the graph goes dark.
 */

function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function nodeState(reachable: boolean, fromMisconfig: string | null): string {
  if (reachable) return "reachable";
  if (fromMisconfig) return "patched"; // was a misconfig, now unreachable: closed
  return "neutral";
}

function toElements(graph: Graph): ElementDefinition[] {
  const reachableIds = new Set(graph.nodes.filter((n) => n.reachable).map((n) => n.id));
  const nodes = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      label: `${n.name}`,
      kind: n.kind,
      state: nodeState(n.reachable, n.fromMisconfig),
    },
  }));
  const edges = graph.edges.map((e) => {
    const lit = reachableIds.has(e.from) && reachableIds.has(e.to);
    const state = lit ? "reachable" : e.viaMisconfig ? "patched" : "neutral";
    return {
      data: { id: e.id, source: e.from, target: e.to, label: e.relation, state },
    };
  });
  return [...nodes, ...edges];
}

export function AttackGraph({ graph }: { graph: Graph | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!boxRef.current || !graph) return;

    const reachable = cssVar("--reachable") || "#9e2f2f";
    const patched = cssVar("--patched") || "#2e5e58";
    const neutral = cssVar("--neutral") || "#8a837a";
    const surface = cssVar("--surface") || "#ffffff";
    const ink = cssVar("--ink") || "#1e2629";
    const inkMuted = cssVar("--ink-muted") || "#4f5b5e";
    // Canvas labels can't read CSS vars, so use a literal face with fallbacks.
    const face = '"Atkinson Hyperlegible Next Variable", system-ui, sans-serif';

    const color = { reachable, patched, neutral } as Record<string, string>;

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
            "text-max-width": "120px",
            "text-valign": "bottom",
            "text-margin-y": 6,
            width: 26,
            height: 26,
            "border-width": 0,
            opacity: (n: NodeSingular) => (n.data("state") === "neutral" ? 0.45 : 1),
          },
        },
        {
          // Lit nodes get a soft halo via the real underlay property (not box-shadow).
          selector: 'node[state = "reachable"]',
          style: {
            "underlay-color": reachable,
            "underlay-opacity": 0.28,
            "underlay-padding": 10,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": (e: EdgeSingular) => color[e.data("state")] ?? neutral,
            "target-arrow-color": (e: EdgeSingular) => color[e.data("state")] ?? neutral,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-family": face,
            "font-size": "10px",
            color: inkMuted,
            "text-background-color": surface,
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            opacity: (e: EdgeSingular) => (e.data("state") === "neutral" ? 0.4 : 1),
          },
        },
      ],
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.3, padding: 24 },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph]);

  return (
    <section className="panel graph" aria-label="Attack graph">
      <div className="panel__head">
        <h2 className="panel__title">Attack graph</h2>
        <span className="type-caption">
          {graph ? `round ${graph.round}` : "waiting for recon"}
        </span>
      </div>
      {graph ? (
        <div ref={boxRef} className="graph__canvas" role="img" aria-label="Resource graph" />
      ) : (
        <div className="graph__empty">Run Recon to build the graph.</div>
      )}
      <ul className="legend" aria-label="Legend">
        <li className="legend__item">
          <span className="legend__swatch legend__swatch--reachable" />
          <span className="legend__label">reachable</span>
        </li>
        <li className="legend__item">
          <span className="legend__swatch legend__swatch--patched" />
          <span className="legend__label">closed</span>
        </li>
        <li className="legend__item">
          <span className="legend__swatch legend__swatch--neutral" />
          <span className="legend__label">neutral</span>
        </li>
      </ul>
    </section>
  );
}
