"use client";

/**
 * A short "what is this" so a first-time viewer understands the game without being told.
 */
export function Explainer() {
  return (
    <section className="panel explainer" aria-label="What is this">
      <h2 className="panel__title">What is this?</h2>
      <p className="explainer__lede">
        Four AI agents play attack and defend on a real (throwaway) cloud project.
      </p>
      <ol className="explainer__list">
        <li><b>Recon</b> maps the project into a graph of resources.</li>
        <li><b>Attacker</b> chains misconfigurations into a path to power.</li>
        <li><b>Referee</b> re-checks each path for real, so the score is honest.</li>
        <li><b>Defender</b> proposes a fix — you approve it before it runs.</li>
      </ol>
      <p className="explainer__foot">
        The number is how many ways an attacker can still reach power. The game is won when
        it hits <b>zero</b> and the graph goes dark.
      </p>
    </section>
  );
}
