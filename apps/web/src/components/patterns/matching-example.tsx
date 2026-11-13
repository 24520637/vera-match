"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { FormActions } from "../ui/form";
import { Modal } from "../ui/modal";
import { Badge } from "../ui/status";

export function MatchingExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <article className="match-example" aria-labelledby="match-example-title">
        <div className="match-example__portrait" aria-hidden="true">
          <span className="display-type">L</span>
          <span>Illustrative profile</span>
        </div>
        <div className="stack">
          <Badge>Fictional example</Badge>
          <div>
            <h3 id="match-example-title" className="match-example__name">
              Linh
            </h3>
            <p className="muted">Looking for a long-term relationship</p>
          </div>
          <p>
            “A good weekend has room for a long walk, a new recipe and the
            people I care about.”
          </p>
          <div>
            <h4 className="match-example__label">A shared starting point</h4>
            <p className="small muted">
              Similar relationship intentions and a shared interest in cooking,
              from self-declared profile details.
            </p>
          </div>
          <div className="inline">
            <Button variant="secondary" onClick={() => setOpen(true)}>
              View example reasoning
            </Button>
          </div>
        </div>
      </article>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Why an introduction might fit"
        description="This fictional example illustrates the presentation of shared interests. It is not a generated match."
      >
        <div className="stack">
          <p>
            Real recommendations must satisfy both members’ preferences, current
            consent and blocking rules.
          </p>
          <p>
            Reasons should identify their source. Only permitted profile details
            and individually approved factual claims may be shared. A percentage
            must never imply a probability of relationship success.
          </p>
          <FormActions>
            <Button onClick={() => setOpen(false)}>Close reasoning</Button>
          </FormActions>
        </div>
      </Modal>
    </>
  );
}
