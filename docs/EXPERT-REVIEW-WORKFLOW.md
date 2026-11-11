# Expert-led video review — workflow and interface specification

**Implementation status:** PLANNED. Human reviewers perform and document assessments through the VERA Match application. No pretrained personality model performs the analysis.

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
