export default function HomePage() {
  return (
    <>
      <span className="pill">Project scaffold · Features not yet implemented</span>
      <h1>VERA Match</h1>
      <p>
        A matchmaking platform built around personal profiles, thoughtful questions,
        and consent-controlled expert reviews of private videos.
      </p>
      <section className="grid">
        <div className="panel">
          <h2>Accounts &amp; security</h2>
          <p>Registration, email verification, login, browser sessions, and account recovery are planned in AUTH-SPEC.</p>
        </div>
        <div className="panel">
          <h2>Private video &amp; expert review</h2>
          <p>Private upload → qualified reviewer assignment → evidence-based notes → independent QA → member approval.</p>
        </div>
        <div className="panel">
          <h2>Mutual matching</h2>
          <p>Reciprocal preferences, clear explanations, member-controlled data sharing, and mutual decisions.</p>
        </div>
      </section>
      <p className="hint">This is a starter, not a working matchmaking service. See README.md and docs/COMMIT-PLAN.md.</p>
    </>
  );
}
