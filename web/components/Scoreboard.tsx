"use client";

import type { Graph, Round } from "@/lib/firestore";

/**
 * The one number that tells the whole story: reachable misconfigs this round, and the
 * descending line across rounds. Reads completed rounds from the rounds collection and
 * the live score from graph/current for the round in progress.
 */
export function Scoreboard({ graph, rounds }: { graph: Graph | null; rounds: Round[] }) {
  // scoreAfter per completed round, then the live score as the latest point.
  const points: { round: number; score: number }[] = [
    ...rounds.map((r) => ({ round: r.round, score: r.scoreAfter })),
  ];
  if (graph && !points.some((p) => p.round === graph.round)) {
    points.push({ round: graph.round, score: graph.score });
  }

  const current = graph?.score ?? points.at(-1)?.score ?? 0;
  const maxScore = Math.max(1, ...points.map((p) => p.score));

  const W = 280;
  const H = 120;
  const pad = 12;
  const stepX = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = H - pad - (p.score / maxScore) * (H - pad * 2);
    return { x, y };
  });
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");

  return (
    <section className="panel score" aria-label="Scoreboard">
      <div className="panel__head">
        <h2 className="panel__title">Ways in</h2>
      </div>
      <div className="score__now">
        <span className={`score__value${current === 0 ? " score__value--zero" : ""}`}>
          {current}
        </span>
        <span className="score__caption">
          {current === 0
            ? "the attacker can reach nothing"
            : `path${current === 1 ? "" : "s"} an attacker can still use`}
        </span>
      </div>
      {points.length > 0 && (
        <svg className="score__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score per round">
          <path className="score__chart-line" d={line} />
          {coords.map((c, i) => (
            <circle key={i} className="score__chart-dot" cx={c.x} cy={c.y} r={3} />
          ))}
        </svg>
      )}
    </section>
  );
}
