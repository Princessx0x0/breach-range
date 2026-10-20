"use client";

export interface RunnerState {
  round: number;
  status: "ready" | "awaiting_approval" | "game_over" | "error";
  next: string;
  nextLabel: string;
  stepIndex: number;
  stepCount: number;
  score: number;
  message: string;
  target: string | null;
}

/**
 * The narrator. One line of plain English for what just happened and what the next step
 * is, plus the single button that advances the game. This is the thing you read and click;
 * everything else on the page is detail.
 */
export function StatusBanner({
  info,
  busy,
  onStep,
  onRound,
  onReset,
  onApprove,
}: {
  info: RunnerState | null;
  busy: boolean;
  onStep: () => void;
  onRound: () => void;
  onReset: () => void;
  onApprove: () => void;
}) {
  if (!info) {
    return (
      <section className="banner">
        <p className="banner__message">Connecting to the runner…</p>
      </section>
    );
  }

  const dots = Array.from({ length: info.stepCount }, (_, i) => i < info.stepIndex);

  let primary: { label: string; onClick: () => void } | null = null;
  if (info.status === "ready") primary = { label: "Run next step", onClick: onStep };
  else if (info.status === "awaiting_approval") primary = { label: "Approve & apply", onClick: onApprove };
  else if (info.status === "game_over") primary = { label: "Start over", onClick: onReset };

  return (
    <section className={`banner banner--${info.status}`} aria-label="What is happening">
      <div className="banner__top">
        <span className="banner__round">
          Round {info.round} · step {Math.min(info.stepIndex, info.stepCount)} of {info.stepCount}
        </span>
        <span className="banner__dots" aria-hidden>
          {dots.map((on, i) => (
            <span key={i} className={`banner__dot${on ? " banner__dot--on" : ""}`} />
          ))}
        </span>
      </div>

      <p className="banner__message">{info.message}</p>

      <div className="banner__actions">
        {primary && (
          <button className="button" onClick={primary.onClick} disabled={busy}>
            {busy ? "Working…" : `${primary.label} ▸`}
          </button>
        )}
        {info.status === "ready" && (
          <button className="button button--secondary" onClick={onRound} disabled={busy}>
            Run whole round
          </button>
        )}
        {info.status !== "game_over" && (
          <button className="banner__reset" onClick={onReset} disabled={busy}>
            Reset
          </button>
        )}
        {info.status === "awaiting_approval" && (
          <span className="banner__hint">A human must approve before anything changes in the project.</span>
        )}
        {info.status === "error" && <span className="banner__hint banner__hint--error">{info.message}</span>}
      </div>
    </section>
  );
}
