import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/status";
import "./home.css";

export default function HomePage() {
  return (
    <div className="container">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <Badge>A considered beginning</Badge>
          <h1 id="home-title">A meaningful connection starts with you.</h1>
          <p className="lede">
            Space to share what matters. Thoughtful human perspectives.
            Introductions shaped by what you both want.
          </p>
          <ButtonLink href="/register">Create your account</ButtonLink>
          <p className="small muted">
            <span translate="no">VERA Match</span> is in development. Private
            video reviews and matching are still taking shape.
          </p>
        </div>
        <div className="conversation">
          <p className="conversation__intro">A question worth sitting with</p>
          <blockquote>
            “What does feeling at home with someone mean to you?”
          </blockquote>
          <div className="conversation__footer">
            <p>Good introductions begin with better conversations.</p>
            <svg
              className="connection-mark"
              viewBox="0 0 80 80"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M39 66C7 45 6 19 23 17c11-1 17 13 17 13s6-14 17-13c17 2 16 28-16 49"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M40 30v36" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      </section>
      <section
        id="approach"
        className="home-intro"
        aria-labelledby="approach-title"
      >
        <div className="stack">
          <h2 id="approach-title">
            More context.
            <br />
            More considered connections.
          </h2>
          <p className="muted">
            We’re building a quieter way to meet. One that gives your
            intentions, your story and your choices room to be understood.
          </p>
        </div>
        <ol className="journey">
          <li>
            <div>
              <h3>Begin with what matters to you</h3>
              <p>
                Share your interests, relationship intentions and preferences in
                your own words.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Add perspective, on your terms</h3>
              <p>
                Choose whether to share a private video with an assigned human
                reviewer. Review the report after independent quality approval.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Choose a connection, together</h3>
              <p>
                Explore introductions that respect both people’s preferences.
                You each decide whether to take the next step.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section
        id="privacy"
        className="privacy-panel"
        aria-labelledby="privacy-title"
      >
        <div className="stack">
          <h2 id="privacy-title">Your story belongs to you.</h2>
          <p>
            Private video. Separate permissions. A say in every claim that can
            be shared.
          </p>
        </div>
        <div className="stack">
          <p>
            Human review adds context, not a label. A short video cannot
            establish honesty, character or the future of a relationship.
          </p>
          <p>
            These protections are part of our design requirements. Private video
            review and matching services are still in development.
          </p>
          <Link href="/design-system#patterns">
            See how member control is designed
          </Link>
        </div>
      </section>
    </div>
  );
}
