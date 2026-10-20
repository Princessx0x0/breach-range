"use client";

import type { EventDoc } from "@/lib/firestore";

/**
 * The current round's proposed Terraform change, so judges see the Defender do something
 * concrete. Renders the unified diff from the latest defender.proposed event's payload,
 * line-coloured by state (removed = reachable red, added = patched green).
 */
function latestProposed(events: EventDoc[]): EventDoc | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].action === "defender.proposed") return events[i];
  }
  return null;
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
    return "diff__line diff__line--meta";
  }
  if (line.startsWith("+")) return "diff__line diff__line--add";
  if (line.startsWith("-")) return "diff__line diff__line--del";
  return "diff__line";
}

export function PatchDiff({ events }: { events: EventDoc[] }) {
  const proposed = latestProposed(events);
  const diff = (proposed?.payload?.diff as string | undefined) ?? "";
  const title = (proposed?.result as string | undefined) ?? "No patch proposed yet.";

  return (
    <section className="panel" aria-label="Patch diff">
      <div className="panel__head">
        <h2 className="panel__title">Proposed patch</h2>
      </div>
      <p className="type-caption">{title}</p>
      {diff && (
        <pre className="diff">
          <code>
            {diff.split("\n").map((line, i) => (
              <span key={i} className={lineClass(line)}>
                {line || " "}
              </span>
            ))}
          </code>
        </pre>
      )}
    </section>
  );
}
