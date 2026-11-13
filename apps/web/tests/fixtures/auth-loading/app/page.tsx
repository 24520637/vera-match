import { StateHarness } from "../state-harness";

export default function FixturePage() {
  return (
    <main id="main-content" tabIndex={-1} className="container">
      <StateHarness />
    </main>
  );
}
