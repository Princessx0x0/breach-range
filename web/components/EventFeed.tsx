"use client";

import type { EventDoc } from "@/lib/firestore";

/**
 * The append-only event log, streaming in, colour-coded by agent. This is where "real
 * time" is felt and, after the demo, the audit trail. Newest at the top.
 */
export function EventFeed({ events }: { events: EventDoc[] }) {
  const rows = [...events].reverse();
  return (
    <section className="panel feed" aria-label="Event feed">
      <div className="panel__head">
        <h2 className="panel__title">Event feed</h2>
        <span className="type-caption">{events.length} events</span>
      </div>
      {rows.length === 0 ? (
        <p className="type-caption">No events yet.</p>
      ) : (
        <ul className="feed__list">
          {rows.map((e) => (
            <li key={e.id} className="feed__row">
              <span className={`feed__agent feed__agent--${e.agent}`}>{e.agent}</span>
              <span className={`pill pill--${e.status}`}>{e.status}</span>
              <span className="feed__text">
                <span className="feed__round">r{e.round} </span>
                {e.result ?? e.action}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
