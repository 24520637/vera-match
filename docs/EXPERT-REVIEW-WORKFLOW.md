# Expert-led video review — workflow and interface specification

T10 implements draft submission, independent QA, and private owner reports. T12 adds factual claims, granular owner permission, disputes, and a matching eligibility reader. Human reviewers perform and document assessments through the VERA Match application.

## 1. Participants and safeguards

- **MEMBER:** owns the video, grants and revokes permissions, receives a QA-approved report, may respond/dispute, and controls sharing of eligible factual statements.
- **EXPERT:** an approved and appropriately trained human reviewer with access only to assigned videos.
- **MODERATOR / QA:** manages reviewer eligibility, assignment, and independent review quality checks; the assessor cannot approve their own review.
- **ADMIN:** manages access and operations but does not obtain unrestricted private video access without a lawful, auditable purpose.

Human assessments are **interpretations of observable material**, with explicit uncertainties and limitations—not certified psychological diagnoses or definitive personality labels.

## 2. End-to-end workflow

1. A member grants video storage/review consent and uploads a file to a private bucket; metadata moves from `UPLOADING` to `READY` only after object validation.
2. A moderator selects an eligible, available reviewer and creates `ExpertAssignment(status=ASSIGNED, dueAt=...)`. Confirm `EXPERT_VIDEO_REVIEW` consent at assignment time.
3. On opening the workspace, the API checks active account, role, reviewer eligibility, assignment, video state, and current owner consent. Only then issue a short-lived private playback URL and audit the access.
4. The expert reviews the video using a timestamped timeline and records `startMs`, `endMs`, category, neutral observation, and context. Categories: `EYE`, `FACIAL`, `BODY`, `SPEECH`, `CROSS_MODAL`. Timestamps must be within the video duration.
5. The editor supports `DRAFT` autosave and an optimistic version number; stale concurrent edits must return a conflict instead of silently overwriting another version.
6. The expert writes a balanced summary, separates direct observation from hypotheses, explains uncertainties, and completes mandatory `limitations`. Submission transitions a locked version into `SUBMITTED`.
7. An independent QA moderator may **return** the review with actionable feedback or **approve** it; every decision has a timestamp and audit trail. The author cannot self-approve.
8. The member sees only the `APPROVED` report and may comment, file a dispute, and individually confirm, share, or revoke eligible factual claims.
9. Matching may consider only `ReviewClaim` records that are QA-approved, owner-confirmed, explicitly share-approved, not revoked, and covered by **current** matching/share consent. Subjective personality judgments never directly affect the score.
10. If the member withdraws consent or deletes the video, revoke playback privileges, cancel or close dependent assignments, exclude related claims from matching, and follow the documented retention/deletion policy.

## 3. Screens and essential states

| Screen | Behavior and UI states |
| --- | --- |
| Expert Dashboard | Only assigned jobs; due dates; `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`; loading/empty/error |
| Assignment Detail | Minimal case data, eligibility/access notices, current consent, revoked assignment state |
| Private Video Workspace | Authorized player, timeline markers, timestamp jumps, accessible controls, expiring URL handling |
| Observation Editor | All five categories; evidence range and context validation; auto-save; network/retry/conflict states |
| Review Summary & Submission | Findings and limitations, explicit uncertainty, required field checks, confirmation and locked submission |
| Moderator QA | Submitted queue, review snapshot, actionable return reasons, approval and self-approval prevention |
| Member Report | QA-approved report, uncertainty and limitations, granular claim confirmation/share/revoke, feedback/dispute |
| Dispute Resolution | Ownership-checked case details, evidence, response history, resolution status, audited actions |

## 4. Five observation categories — reviewer guidance

- **EYE:** Describe observable eye/head direction over time; do not infer truthfulness or deception.
- **FACIAL:** Describe expressions and movements without treating any expression as definitive proof of a mental state.
- **BODY:** Note gestures and posture in the recording's context; do not infer moral character from them.
- **SPEECH:** Record content and speaking patterns. If a manual transcript is used, ensure owner visibility/confirmation as required.
- **CROSS_MODAL:** Document temporal co-occurrence of cues; do not claim stable personality without independent validated evidence.

## 5. Permission and transition test matrix

- Unassigned expert → `403`; revoked/expired assignment or consent → playback and edit denied; expired signed URL cannot be reused.
- Draft/private notes are never visible to the member or another reviewer without explicit authorization; member sees only an approved report.
- A review author cannot act as its QA approver. Returned reviews can be revised and resubmitted without overwriting the audit trail.
- Invalid categories or out-of-range timestamps fail validation; stale optimistic versions fail with `409`.
- Claim withdrawal removes the claim from matching promptly; an open dispute cannot silently mutate the approved snapshot or reveal another person's notes.

## 6. T10 implementation

The reviewer workspace is `/expert/assignments/:assignmentId/review`, the
moderator queue is `/qa/reviews`, and the owner report page is
`/account/reviews`. T10 uses the draft API, editor, draft invariants, and
server-measured video duration from T08 at `5c6c8f4`. The draft API uses
`GET/POST /api/expert/assignments/:assignmentId/draft` and
`PATCH /api/expert/reviews/:id/draft`. Current storage and review consent,
their bound generations, reviewer qualification, and the existing
session-bound access rules apply to every expert request.

| Step | API behavior |
| --- | --- |
| C055 | Submission validates the saved summary, limitations, and each saved observation against the current verified duration. Blank summary or limitations return `422 REVIEW_INCOMPLETE` with field details. A narrative review may be submitted without timecoded observations or a transcript. |
| C056 | `POST /api/expert/reviews/:id/submit` accepts `{ expectedVersion }`. It advances the review and assignment in one transaction with audit evidence. The same expected version replays the same receipt while the review is submitted. The editor and expert playback are locked while QA is pending. |
| C057 | `POST /api/qa/reviews/:id/return` accepts `{ expectedVersion, reason }`. The actionable reason must contain 1 to 2,000 characters after trimming. The expert can revise the returned version and resubmit. Previous decisions remain in the private review history. |
| C058 | `GET /api/qa/reviews` and `GET /api/qa/reviews/:id` show submissions to independent moderators with session-bound MFA and a current C035 moderator grant for the assignment. The same grant is required to return or approve the review. `POST /api/qa/reviews/:id/approve` accepts `{ expectedVersion }`, validates the snapshot and completes the assignment. Authors cannot decide on their own submissions, including after a role change. |
| C059 | `GET /api/reviews/me` returns only the caller's approved reports with matching independent QA evidence. Each report includes summary, limitations, approval time, reviewer display name when available, and source video reference and upload time. Raw timeline notes, QA feedback, moderator identity, and storage locators stay private. |
| C060 | Focused tests exercise field and version validation, transition guards, authorization, and the owner projection. PostgreSQL integration scenarios cover concurrent submission, concurrent draft edit and submit, return and resubmission, moderator grant revocation, approval, and consent withdrawal. |

QA and owner list endpoints accept an optional `after` cursor and return
`nextCursor`. Each transition requires the current version. Invalid states and
stale versions return `409`. The expert-visible submitted receipt carries
`id`, `status`, `version` and `submittedAt`. Private API responses use
`Cache-Control: private, no-store`, `Vary: Cookie`, and a no-referrer policy.

The owner report requires current storage and expert review permissions tied
to the original source generation. Withdrawal or source deletion stops new
report reads. Regrant does not restore an old report. Retained report access
following review-only withdrawal requires separate policy approval. QA action
history remains attached to the live review. General audit events contain
identifiers and action metadata.

Staff assurance and expert qualification retain their fail-closed defaults.
Production access still requires approved evidence and trusted session-bound
assurance providers.

## 7. T12 claims and disputes

All paths below are relative to `/api`. The member uses `/account/reviews`.
The moderator uses `/qa/reviews` for both submitted reviews and disputes.
Reads and writes require a valid session and responses use private, no-store
headers. Browser writes require JSON and the configured application origin.

### QA approval

`GET /qa/reviews/:id` includes observation IDs and a `claimTypes` catalog
of `{ type, statement }`. `POST /qa/reviews/:id/approve` accepts
`{ expectedVersion, claims? }`. Each optional claim contains `type`,
`observationId`, `context` (1–1,000 characters), and optional `transcript`
(1–2,000 characters). A type may appear once per review. The catalog contains
six self-reported interests. An independent moderator checks that the speech
supports the selected statement in context. The server supplies the canonical
statement and copies timecodes from a speech observation on the submitted
snapshot. QA, claim creation, assignment completion, and audit commit together.
Claims start unconfirmed and unshared. Approval still accepts an empty claim
list or a body containing only `expectedVersion`.

### Individual owner decisions

`GET /reviews/me` adds a `claims` array to each approved report. Claim items
contain `id`, `type`, `statement`, `evidence`, `ownerConfirmed`,
`shareApproved`, `revokedAt`, and `revision`. Evidence contains `startMs`,
`endMs`, `context`, and nullable `transcript`. Claim approval provenance must
match the visible report version. The owner sees only approved claim evidence.

Each claim includes `feedback`, an array of the owner's private annotations.
`PATCH /reviews/claims/:id/feedback` accepts `{ target, note, expectedRevision }`
and returns `{ feedback }`. The target is `CONTEXT` or `TRANSCRIPT`. A
transcript must exist before it can be annotated. A note has 1–2,000 characters.
Use revision `0` for a new annotation. Each target has its own revision, and
saving identical text again returns the current annotation. Each item contains
`target`, `note`, `revision`, and `updatedAt`. Inaccessible claims return `404`
and an edit against a stale revision returns `409`. Annotations are visible in
the owner's report and leave the approved evidence, disputes, and sharing state
unchanged. Matching receives only the permitted canonical statement.

`PATCH /reviews/claims/:id` accepts `{ action, expectedRevision }` and returns
`{ claim }`. The actions are `CONFIRM`, `SHARE`, and `REVOKE`. Sharing requires
a confirmed claim and current `PROFILE_MATCHING`, `REPORT_SHARING`, and
`VIDEO_CLAIM_MATCHING` consent. Withdrawal invalidates the stored consent
generation. A later grant requires a fresh explicit share. Individual revocation
is permanent for that claim. An inaccessible claim returns `404`, absent sharing
consent returns `403`, and stale revisions or invalid transitions return `409`.

### Disputes

`POST /reviews/:id/disputes` accepts `{ reason, claimId? }`. The reason has
1–2,000 characters. Omitting `claimId` opens a dispute about the entire report.
Each approved report version supports one active dispute. The call returns
`201` with `{ dispute }`. The owner sees the ten most recent disputes on the
report, including moderator responses and timestamps.

Moderators use `GET /qa/reviews/disputes` to list active cases and
`GET /qa/reviews/disputes/:id` returns `{ dispute, reviewId, report, claim }`.
For an entire-report dispute, `report` contains `version`, `summary`,
`limitations`, and `approvedAt`, and `claim` is null. For a claim dispute,
`claim` contains its statement and evidence, and `report` is null. Reading and
deciding a case require independent, session-bound MFA, a current grant for
the assignment, current source consent, and the approved snapshot for that
dispute version. The case screen enables decisions after the case context is
loaded. `PATCH /qa/reviews/disputes/:id` accepts
`{ status, expectedRevision, resolution? }` and returns `{ dispute }`.
Intake moves `OPEN` to `IN_REVIEW`. Closing moves `IN_REVIEW` to `RESOLVED`
(upheld) or `REJECTED`, with a response of 1–2,000 characters.
The approved review version remains immutable throughout the dispute. General
audit records contain action and identifiers. Free text stays in the case.

### Matching eligibility

`readMatchingClaimsInTransaction` checks participant blocks and current
consents under sorted user locks. It checks current source authorization,
independent QA, owner confirmation, consent-generation-bound sharing, and
individual revocation. Open, in-review, and upheld disputes suppress affected
claims. It returns only distinct canonical claim types and statements. T14
owns pair eligibility, scores, explanations, and the recommendations endpoint.
Use the claim reader in the transaction that consumes the result.
