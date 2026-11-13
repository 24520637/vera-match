import type { Metadata } from "next";
import {
  PageHeader,
  Section,
  WorkspaceLayout,
} from "@/components/layout/page-layout";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import {
  Badge,
  EmptyState,
  LoadingState,
  Notice,
} from "@/components/ui/status";
import { AuthExample } from "@/components/patterns/auth-example";
import { ProfileExample } from "@/components/patterns/profile-example";
import { MatchingExample } from "@/components/patterns/matching-example";
import { ReviewExample } from "@/components/patterns/review-example";
import { FormExample } from "@/components/patterns/form-example";
import "./design-system.css";

export const metadata: Metadata = {
  title: "Design system preview",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  return (
    <div className="container">
      <div className="design-intro">
        <PageHeader
          title="A considered space for connection."
          description="The shared visual language of VERA Match. Calm, personal and clear about the choices that belong to you."
        >
          <div className="design-meta">
            <Badge>Design system proposal</Badge>
            <span>For Huong’s visual and component review</span>
          </div>
          <p className="small muted">
            Interactive examples use fictional details. They do not sign you in,
            save a profile, create matches or access private videos.
          </p>
        </PageHeader>
      </div>
      <WorkspaceLayout
        sidebar={
          <nav aria-label="Design system sections" className="section-nav">
            <a href="#foundations">Foundations</a>
            <a href="#components">Components</a>
            <a href="#patterns">Product patterns</a>
            <a href="#states">Feedback & states</a>
          </nav>
        }
      >
        <Section
          id="foundations"
          title="Quiet confidence."
          description="Plum ink, a cool lilac ground and a measured touch of sage. Editorial type makes room for the person behind the profile."
        >
          <ul className="swatches">
            {[
              ["canvas", "Mist", "#F5F3F8"],
              ["paper", "Paper", "#FFFFFF"],
              ["ink", "Ink", "#35263B"],
              ["plum", "Plum", "#513957"],
              ["sage", "Sage", "#DCE8E0"],
              ["lilac", "Lilac", "#E9E0EE"],
            ].map(([key, name, hex]) => (
              <li key={key}>
                <div className={`swatch swatch--${key}`} aria-hidden="true" />
                <strong>{name}</strong>
                <span className="small muted">{hex}</span>
              </li>
            ))}
          </ul>
          <div className="type-specimen">
            <div className="stack">
              <p className="display-type">
                Every person,
                <br />a fuller story.
              </p>
              <p className="small muted">Newsreader · Editorial headings</p>
            </div>
            <div className="stack">
              <p>
                Choose what you share.
                <br />
                Understand what happens next.
              </p>
              <p className="small muted">
                Instrument Sans · Reading and controls
              </p>
            </div>
          </div>
        </Section>
        <Section
          id="components"
          title="Familiar by design."
          description="A small set of reusable controls. Clear labels, generous targets and visible focus keep attention on the task."
        >
          <div className="component-group">
            <h3>Actions</h3>
            <div className="component-group__content">
              <div className="inline">
                <ButtonLink href="#patterns">Explore patterns</ButtonLink>
                <ButtonLink href="#states" variant="secondary">
                  View states
                </ButtonLink>
                <ButtonLink href="#foundations" variant="quiet">
                  Back to foundations
                </ButtonLink>
              </div>
              <p className="small muted">
                One primary action per task. Links navigate; buttons act.
                Destructive actions ask for confirmation.
              </p>
              <div className="inline">
                <Button loading loadingLabel="Saving…">
                  Save changes
                </Button>
                <Button disabled>Unavailable</Button>
              </div>
            </div>
          </div>
          <div className="component-group">
            <h3>Fields</h3>
            <div className="component-group__content">
              <div className="sample-controls">
                <Input
                  name="sampleName"
                  label="Display name"
                  autoComplete="off"
                  placeholder="Your first name…"
                  hint="Use a name you’re comfortable sharing."
                />
                <Select
                  name="sampleVisibility"
                  label="Profile visibility"
                  autoComplete="off"
                  defaultValue="private"
                >
                  <option value="private">Only you</option>
                  <option value="matching">Eligible introductions</option>
                </Select>
              </div>
              <Input
                name="sampleDisabled"
                label="Reviewer assignment"
                autoComplete="off"
                disabled
                value="Available after consent is confirmed"
                readOnly
              />
              <p className="small muted">
                These controls are isolated examples. They do not change your
                account settings.
              </p>
            </div>
          </div>
          <div className="component-group">
            <h3>Form states</h3>
            <div className="component-group__content">
              <div className="sample-controls">
                <FormExample />
              </div>
            </div>
          </div>
          <div className="component-group">
            <h3>Contained content</h3>
            <div className="component-group__content">
              <Card tone="sage">
                <div className="stack">
                  <h3>Keep the context close</h3>
                  <p>
                    A card groups one focused task. A list of recommendations or
                    review observations belongs in readable rows, not a wall of
                    identical boxes.
                  </p>
                </div>
              </Card>
              <div className="inline">
                <Badge>Draft</Badge>
                <Badge tone="success">QA approved</Badge>
                <Badge tone="warning">Needs your review</Badge>
              </div>
              <p className="small muted">
                Status examples describe workflow stages, never identity
                verification.
              </p>
            </div>
          </div>
        </Section>
        <Section
          id="patterns"
          title="One language. Different moments."
          description="Patterns adapt to the work: a focused sign-in form, a member’s own words, a considered introduction and a private review workspace."
        >
          <section className="pattern-block" aria-labelledby="auth-pattern">
            <div className="pattern-block__heading">
              <h3 id="auth-pattern">Authentication</h3>
              <p className="small muted">
                A focused form with a clear next step.
              </p>
            </div>
            <div className="pattern-columns">
              <AuthExample />
              <div className="pattern-notes">
                <p>
                  Keep the form narrow and the language direct. Let password
                  managers do their work.
                </p>
                <ul>
                  <li>Label every field; connect hints and errors.</li>
                  <li>Focus the first invalid field after submission.</li>
                  <li>
                    Offer retry for an outage. Redirect to sign-in only for an
                    actual expired or invalid session.
                  </li>
                </ul>
              </div>
            </div>
          </section>
          <section className="pattern-block" aria-labelledby="profile-pattern">
            <div className="pattern-block__heading">
              <h3 id="profile-pattern">Profiles & preferences</h3>
              <p className="small muted">
                A person’s story, with individual sharing choices.
              </p>
            </div>
            <div className="pattern-columns">
              <ProfileExample />
              <div className="pattern-notes">
                <p>
                  Group related fields under a meaningful legend. Optional
                  details stay optional.
                </p>
                <p>
                  Permissions are separate and start off. In the real flow,
                  consent changes require server confirmation and a clear way to
                  revoke.
                </p>
                <p>
                  Example edits stay in this page’s memory. Leaving with
                  unchecked changes asks for confirmation.
                </p>
              </div>
            </div>
          </section>
          <section className="pattern-block" aria-labelledby="matching-pattern">
            <div className="pattern-block__heading">
              <h3 id="matching-pattern">Thoughtful introductions</h3>
              <p className="small muted">
                Lead with the person. Explain the shared context.
              </p>
            </div>
            <MatchingExample />
          </section>
          <section className="pattern-block" aria-labelledby="review-pattern">
            <div className="pattern-block__heading">
              <h3 id="review-pattern">Expert video review</h3>
              <p className="small muted">
                Evidence and context sit together. Access stays explicit.
              </p>
            </div>
            <ReviewExample />
          </section>
        </Section>
        <Section
          id="states"
          title="Clarity in every state."
          description="Feedback names what happened and what you can do next. Meaning never depends on color alone."
        >
          <div className="state-row">
            <h3>Loading</h3>
            <LoadingState label="Loading your introductions…" />
          </div>
          <div className="state-row">
            <h3>Empty</h3>
            <EmptyState
              title="Room for a new introduction"
              action={
                <ButtonLink href="#profile-pattern" variant="secondary">
                  Review preferences example
                </ButtonLink>
              }
            >
              When eligible introductions are available, they’ll appear here.
              You can review your preferences in the meantime.
            </EmptyState>
          </div>
          <div className="state-row">
            <h3>Error</h3>
            <Notice tone="error" title="Your changes could not be saved.">
              Example server error: keep your edits and offer retry when the
              connection returns. An outage does not mean you are signed out.
            </Notice>
          </div>
          <div className="state-row">
            <h3>Success</h3>
            <Notice tone="success" title="Example of a confirmed save">
              In a connected flow, show success only after the server confirms
              the change.
            </Notice>
          </div>
          <div className="state-row">
            <h3>Conflict</h3>
            <Notice tone="warning" title="A newer review is available.">
              Keep the current draft and compare versions before trying to save
              again.
            </Notice>
          </div>
          <div className="state-row">
            <h3>Disabled</h3>
            <div className="stack">
              <div>
                <Button disabled aria-describedby="disabled-reason">
                  Approve review
                </Button>
              </div>
              <p id="disabled-reason" className="small muted">
                A reviewer cannot approve their own assessment. Independent QA
                is required.
              </p>
            </div>
          </div>
        </Section>
      </WorkspaceLayout>
    </div>
  );
}
