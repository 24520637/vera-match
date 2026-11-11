# Product scope and delivery decisions

## P0 — must be built and accepted before release

- Email-based registration, activation and resend; login and session restoration; logout/logout-all; forgot/reset password; role and resource authorization; CSRF and rate-limit controls.
- Profile, preferences, and versioned questionnaire; five separately controllable consent purposes, all off by default.
- Private video recording/upload, playback, deletion, and revocation; no public media bucket or permanent public video URL.
- Reviewer eligibility and approval, assignment, five timestamped observation categories, draft/autosave/submit, independent QA, owner report, dispute, and granular owner confirmation.
- Reciprocal matching, transparent reasons, accept/decline, user blocking and reports, and basic moderator operations.
- Unit/integration/E2E coverage, essential accessibility, appropriate audit trails, and a documented retention/deletion policy.

## P1 — only after P0 succeeds

Post-mutual-match chat, in-app notifications, richer avatars, and advanced data export. These are not required for the two-week release.

## Explicitly excluded

- Pretrained AI inference, automatic personality traits, facial recognition, or simulated deepfake detection.
- Membership/Premium tiers, subscriptions, checkout, payments, paid concierge, or revenue workflows.
- Fake KYC or claims of "verified identity" without a real verification program.
- Advanced analytics, vector search, Redis, or microservices without an established requirement.

## Safe demo boundaries

- Never claim a short video establishes honesty, deception, a stable personality, or probability of romantic success.
- Report the evidence source, observation context, reviewer, independent QA status, uncertainty, and limitations.
- Do not invite real users or deploy publicly before authentication, consent, data security, staff access, privacy operations, and relevant tests are operational.
