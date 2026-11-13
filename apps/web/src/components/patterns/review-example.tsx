"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Checkbox, FormActions, Select, Textarea } from "../ui/form";
import { Modal } from "../ui/modal";
import { Badge, Notice } from "../ui/status";

export function ReviewExample() {
  const [sharingOpen, setSharingOpen] = useState(false);
  return (
    <div className="stack">
      <div className="inline">
        <Badge tone="warning">Assignment required</Badge>
        <span className="small muted">Review workspace example</span>
      </div>
      <div className="review-workspace">
        <div className="video-placeholder">
          <svg
            width="32"
            height="40"
            viewBox="0 0 32 40"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="17"
              width="26"
              height="20"
              rx="4"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M9 17V10a7 7 0 0 1 14 0v7"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          <h3>Private by permission</h3>
          <p>
            A video appears only after the server confirms your assignment and
            the member’s current consent.
          </p>
          <p className="small">No member video is loaded in this preview.</p>
        </div>
        <div className="stack">
          <Select
            name="observationCategory"
            label="Observation category"
            autoComplete="off"
            defaultValue="speech"
          >
            <option value="eye">Eye direction</option>
            <option value="facial">Facial movement</option>
            <option value="body">Body movement</option>
            <option value="speech">Speech</option>
            <option value="cross-modal">Combined observations</option>
          </Select>
          <Textarea
            name="observation"
            label="Observation"
            autoComplete="off"
            disabled
            hint="Available after assignment and consent are checked. Record observable evidence with timestamps, context and limitations."
          />
          <Button disabled>Save observation</Button>
        </div>
      </div>
      <div className="claim-row">
        <div>
          <h3>Member control comes after independent QA</h3>
          <p className="muted small">
            Each factual claim needs a separate confirmation and sharing choice.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setSharingOpen(true)}>
          Explore sharing controls
        </Button>
      </div>
      <Modal
        open={sharingOpen}
        onOpenChange={setSharingOpen}
        title="You decide what is shared"
        description="This is a control example, not a real claim or report. Every permission starts off."
      >
        <div className="stack">
          <Notice title="A review is a contextual assessment.">
            It does not verify a person’s character or predict a relationship.
          </Notice>
          <Checkbox
            name="confirmClaim"
            label="Confirm this example factual claim"
          />
          <Checkbox
            name="shareClaim"
            label="Allow this example claim to be shared"
          />
          <p className="small muted">
            A real claim also needs QA approval and current matching consent.
            Revocation must remove it from matching.
          </p>
          <FormActions>
            <Button onClick={() => setSharingOpen(false)}>Close example</Button>
          </FormActions>
        </div>
      </Modal>
    </div>
  );
}
