# C065 / C066 — Proposed account lifecycle decision record

Status: **PROPOSED / implementation BLOCKED**. Huong / T11. Documentation only.
Baseline develop `aa8d82e`, including merged T10/T12 and PR24/25/26. Neither this document nor
its PR approves a deletion policy, retention duration or irreversible operation.
Do not interpret the proposed names below as existing enums, endpoints or workers.

## Existing guarantees

The User enum has PENDING_EMAIL, ACTIVE, SUSPENDED and DELETED. Session authorization
requires an active verified account; session, reset and verification secrets are
hash-only, expiring and revocable/consumable. There is no C065 closure coordinator,
restricted status session, lifecycle ledger or hard-deletion API. SUSPENDED must not
silently acquire voluntary-closure semantics. Revoking sessions is not physical erasure.

Consent uses authoritative opaque subjects, a live ledger, aggregate CAS version,
immutable events/policy evidence, idempotency and durable withdrawal tasks. Withdrawal
does not require a current published grant policy; the public member service still
requires an ACTIVE verified MEMBER. A coordinator cannot deactivate first and then
pretend that public endpoint will accept the operation. Current registry publication
is absent; test-only evidence is rejected outside tests. No policy is approved here.

Video access requires current authorization/generation. Owner deletion is a soft
deletion with transactional audit, C051 cancellation and durable cleanup handoff.
Cleanup tasks retain private locators independently of live Video/User rows; provider
verification and outstanding upload expiry precede erasure acknowledgement.
Signed GET capabilities are capped at 60 seconds and PUT capabilities at 300 seconds;
already issued capabilities/in-flight bytes cannot be recalled by an API state change.
Do not expose locators or signed URLs in closure evidence or status responses.

C051 cancels ASSIGNED, IN_PROGRESS and SUBMITTED assignments for owner deletion or
VIDEO_STORAGE / EXPERT_VIDEO_REVIEW withdrawal using latest revision CAS, immutable
AssignmentEvent/context, durable receipts and the agreed locks. COMPLETED/CANCELLED
are terminal. Re-consent/reapproval never rebinds old assignments. C051 is not a
generic expert-account termination API; its current reason enum has no ACCOUNT_CLOSED.

Safety reports/actions and selected audit evidence are preserved independently of
live identity. Opaque IDs remain potentially identifying data. Technical survival
is not permission for indefinite retention, and unlinking an FK is not anonymization.

## Proposed states and acceptance criteria — approval required

Use a separate versioned closure request/ledger if approved; do not add these states
to AccountStatus by implication. Each transition needs a server-owned timestamp,
minimal event and explicit preconditions. Retrying a phase is not a new closure.

| Proposed state | Required evidence before entering / leaving |
| --- | --- |
| REQUESTED | Authenticated owner, agreed recent reauthentication, explicit confirmation, idempotency fingerprint and accepted request recorded. No irreversible change solely from loading a page. |
| RESTRICTED | Atomic durable access barrier, all sessions revoked, unused verification/reset credentials invalidated, login/reset issuance blocked, relevant consent OFF events/generations and work handoffs recorded. If this transaction fails, no success acknowledgement. |
| CLEANUP_PENDING | Owner media tombstoned; eligible assignments cancelled through CAS/events; all downstream consumers have durable, independently acknowledged work. Missing consumers leave this state blocked, never silently COMPLETE. |
| LIVE_STORAGE_VERIFIED | Provider confirms required objects absent after every issued upload capability expires/reconciliation runs; no qualifying active assignment or unacknowledged consumer remains. Distinguish provider outage/unknown state from absence. |
| RETENTION_PENDING | Live service data minimized under approved rules, only explicitly allowed evidence/hold/backup obligations retained; status accurately says retention remains. |
| PURGE_ELIGIBLE | Approved retention/hold decisions permit purge, all consumers and backup obligations reconciled, required audit verification complete. Eligibility is not a purge instruction. |
| PURGED | A separately reviewed implementation proves the approved final deletion/de-identification scope including backups or their approved expiry; cannot claim unrecallable downloaded copies erased. |

Retryable failure, POLICY_BLOCKED and HOLD should be orthogonal conditions with
sanitized codes, next review and ownership, not transitions that reopen access.
Legal hold may postpone approved evidence purge; it must not silently restore private
access or justify retaining media contrary to an agreed policy. No duration is chosen.
The product must decide whether cancellation/reopening is ever allowed and until which
phase. Default proposal: no automatic undo; even an approved reopening cannot resurrect
old sessions, consent generations, assignment bindings or delivered capabilities.

## Proposed transaction and reconciliation sequence

1. Scope initial self-service closure to MEMBER only, subject to approval. Expert,
   moderator and admin deprovisioning affect other people's work and need a distinct
   agreed workflow. ADMIN does not inherit authority to close arbitrary accounts.
2. Derive identity from the authenticated server context, verify recent reauthentication
   and exact Origin/CSRF policy, validate input, quotas and a per-request idempotency
   key/fingerprint. A request ID or email alone must never authorize closure or status.
3. Under the existing partial order (sorted Users → Session when needed → sorted Videos
   → ExpertCredential when needed → sorted Assignments), reread current state. Record
   the durable closure barrier, revoke/consume credentials, and generate real OFF events
   and generation-bound work before removing any live mappings. No nested transaction,
   provider I/O while holding domain locks, fake staff identity or fabricated grant.
   Extracting a reusable transactional consent restriction helper requires Phuc review;
   the existing public ConsentService must not be bypassed with unrelated bulk writes.
4. Every authorization/issuance/mutation consumer must honor the committed barrier in
   the same transaction/lock boundary as its existing account/consent checks. A new enum
   alone cannot prove this. Define an approved mapping to existing account status so
   login, reset and already-authenticated operations cannot proceed after RESTRICTED.
5. Cancel owner assignments through C051, preserving reason/initiator, revision exactly
   once, immutable actor/snapshot and event. Repeated delivery must not duplicate events.
   For a closing EXPERT, deny work on others' videos immediately, but do not delete those
   videos. A new approved cancellation/credential-revocation contract is required; do
   not misuse VIDEO_DELETED or forge an owner withdrawal as an expert closure reason.
6. Persist private cleanup locators and per-consumer acknowledgements before removing
   Video/ConsentLedger/actor mappings. C051's assignment receipt and the video receipt
   are separate; neither completes the shared ConsentWithdrawalTask for missing
   Matching/Review/QA/Claims consumers. Missing lineage remains blocked for reconciliation.
7. Allow normal workers to retry independently, preserving immutable evidence and
   generation isolation. Confirm final/staging object absence after outstanding PUT
   expiry; a PUT issued before closure can finish late and recreate incoming bytes.
   Lost provider/DB acknowledgement leaves UNKNOWN/PENDING until verified, not erased.
8. Apply approved minimization/retention/hold decisions only after all handoffs are
   durable. Do not issue `User.delete()` as a shortcut: cascades and restrictive FKs
   below cannot implement the business sequence. Do not disable triggers to purge.
9. Reconcile backups and replicas before a final purge claim. Restoration from an older
   backup can revive revoked access and deleted data; a trusted post-backup restriction
   journal/replay procedure is absent and blocks production acceptance. Neither a C051
   scan nor a successful synthetic restore can recreate evidence missing from a backup.

## Idempotency, races and failures — proposed contract

A closure has its own stable operation identity and revision/CAS, distinct from
profile revisions, questionnaire versions, consent generations and assignment revision.
Same authorized key + same payload returns the recorded operation, never a second
withdrawal/event chain; changed payload returns 409. Define key hashing, binding,
expiry/retention and replay-after-account-removal before implementation. Do not reuse
ConsentIdempotency expiry as a deletion policy or let replay restore access.

5xx/timeout after commit is an uncertain result: preserve the key and reconcile via an
authorized status mechanism before retrying; don't create a new request automatically.
429 preserves pending intent and exposes the existing Retry-After contract, with no
automatic destructive retry. Stale revision returns conflict/reload. Unknown provider
or database state remains pending. Retry policy must not cap failures by marking COMPLETE.
Error bodies/logs contain only allowlisted codes and necessary field feedback, not
account existence, raw exceptions, retained report text, private keys or bearer material.

Race acceptance must cover login/reset issuance and consumption, verification, consent
grant/re-consent, upload intent/confirm/late PUT, owner/expert playback, assign/reassign,
expert edit/submit, QA/claim publication, matching reads and closure concurrency. After
the barrier commits, no new authorization may be issued. Operations serialized before
it may have in-flight effects; the agreed capability/cleanup rules must handle them.

## Proposed user interface and status access

Reuse the shared design system, accessible explicit confirmation, recent reauthentication,
clear consequences and a pending/error state that preserves the operation identity without
storing secrets/private text. Never auto-submit on page load, countdown or connectivity recovery.
Hide private content when session is uncertain. Do not display “all data permanently
deleted” for a 202, cancellation receipt, soft tombstone or LIVE_STORAGE_VERIFIED alone.
Explain retention/hold limitations using approved policy copy, not invented legal claims.

After all sessions are revoked, how does the owner authenticate a status/recovery check?
Choose a separately restricted, expiring capability or a narrowly scoped reauthentication
flow, with enumeration resistance and quotas. No such mechanism exists now. Do not add a
public request-ID lookup or retain the old full-privilege session as a workaround.
C066 UI and the status API remain BLOCKED pending that contract.

## Relationship inventory and deletion hazards

The following inventory comes from the actual 22-migration schema on develop and a
fresh disposable PostgreSQL 18 catalog, not hypothetical future models. The separate
C095 rehearsal restored and compared all 50 foreign keys and 61 non-internal triggers.
No database, application code, schema or migration changes are made by this PR.
Refresh this inventory after any pending Phuc migration merges.

| Child column → parent column | ON DELETE | SQL constraint |
| --- | --- | --- |
| `AssignmentCancellationContext.eventId` → `AssignmentEvent.id` | RESTRICT | `AssignmentCancellationContext_eventId_fkey` |
| `AssignmentCancellationContext.sourceTaskId` → `ConsentWithdrawalTask.id` | RESTRICT | `AssignmentCancellationContext_sourceTaskId_fkey` |
| `AssignmentEvent.credentialApprovalId` → `ExpertCredentialApproval.id` | RESTRICT | `AssignmentEvent_credentialApprovalId_fkey` |
| `AssignmentIdempotency.assignmentId` → `ExpertAssignmentIdentity.assignmentId` | RESTRICT | `AssignmentIdempotency_identity_fkey` |
| `AssignmentModeratorGrantEvent.grantId` → `AssignmentModeratorGrantEvent.id` | RESTRICT | `AssignmentModeratorGrantEvent_grantId_fkey` |
| `AssignmentModeratorGrantEvent.scopeId` → `AssignmentModeratorScope.id` | RESTRICT | `AssignmentModeratorGrantEvent_scopeId_fkey` |
| `AssignmentModeratorScope.assignmentId` → `ExpertAssignmentIdentity.assignmentId` | RESTRICT | `AssignmentModeratorScope_assignmentId_fkey` |
| `AssignmentModeratorScope.currentGrantId` → `AssignmentModeratorGrantEvent.id` | RESTRICT | `AssignmentModeratorScope_currentGrantId_fkey` |
| `AssignmentWithdrawalReceipt.withdrawalTaskId` → `ConsentWithdrawalTask.id` | RESTRICT | `AssignmentWithdrawalReceipt_withdrawalTaskId_fkey` |
| `Block.blockedId` → `User.id` | CASCADE | `Block_blockedId_fkey` |
| `Block.blockerId` → `User.id` | CASCADE | `Block_blockerId_fkey` |
| `Consent.policyEvidenceId` → `ConsentPolicyEvidence.id` | RESTRICT | `Consent_policyEvidenceId_fkey` |
| `Consent.userId` → `User.id` | CASCADE | `Consent_userId_fkey` |
| `ConsentEvent.policyEvidenceId` → `ConsentPolicyEvidence.id` | RESTRICT | `ConsentEvent_policyEvidenceId_fkey` |
| `ConsentEvent.subjectId` → `ConsentSubject.id` | RESTRICT | `ConsentEvent_subjectId_fkey` |
| `ConsentIdempotency.subjectId` → `ConsentSubject.id` | RESTRICT | `ConsentIdempotency_subjectId_fkey` |
| `ConsentLedger.subjectId` → `ConsentSubject.id` | RESTRICT | `ConsentLedger_subjectId_fkey` |
| `ConsentLedger.userId` → `User.id` | CASCADE | `ConsentLedger_userId_fkey` |
| `ConsentWithdrawalTask.eventId` → `ConsentEvent.id` | RESTRICT | `ConsentWithdrawalTask_eventId_fkey` |
| `ConsentWithdrawalTask.subjectId` → `ConsentSubject.id` | RESTRICT | `ConsentWithdrawalTask_subjectId_fkey` |
| `EmailVerificationToken.userId` → `User.id` | CASCADE | `EmailVerificationToken_userId_fkey` |
| `ExpertActorIdentity.userId` → `User.id` | CASCADE | `ExpertActorIdentity_userId_fkey` |
| `ExpertAssignment.assignedById` → `User.id` | SET NULL | `ExpertAssignment_assignedById_fkey` |
| `ExpertAssignment.credentialApprovalId` → `ExpertCredentialApproval.id` | RESTRICT | `ExpertAssignment_credentialApprovalId_fkey` |
| `ExpertAssignment.expertId` → `User.id` | RESTRICT | `ExpertAssignment_expertId_fkey` |
| `ExpertAssignment.reviewConsentSubjectId` → `ConsentSubject.id` | RESTRICT | `ExpertAssignment_review_subject_fkey` |
| `ExpertAssignment.videoId` → `Video.id` | CASCADE | `ExpertAssignment_videoId_fkey` |
| `ExpertCredential.approvalId` → `ExpertCredentialApproval.id` | RESTRICT | `ExpertCredential_approvalId_fkey` |
| `ExpertCredential.userId` → `User.id` | CASCADE | `ExpertCredential_userId_fkey` |
| `ExpertCredentialEvent.approvalId` → `ExpertCredentialApproval.id` | RESTRICT | `ExpertCredentialEvent_approvalId_fkey` |
| `ExpertObservation.reviewId` → `ExpertReview.id` | CASCADE | `ExpertObservation_reviewId_fkey` |
| `ExpertReview.assignmentId` → `ExpertAssignment.id` | CASCADE | `ExpertReview_assignmentId_fkey` |
| `MatchDecision.pairId` → `MatchPair.id` | CASCADE | `MatchDecision_pairId_fkey` |
| `MatchPreference.userId` → `User.id` | CASCADE | `MatchPreference_userId_fkey` |
| `MemberResourceRevision.userId` → `User.id` | CASCADE | `MemberResourceRevision_userId_fkey` |
| `PasswordResetToken.userId` → `User.id` | CASCADE | `PasswordResetToken_userId_fkey` |
| `Profile.userId` → `User.id` | CASCADE | `Profile_userId_fkey` |
| `QuestionnaireAnswer.userId` → `User.id` | CASCADE | `QuestionnaireAnswer_userId_fkey` |
| `Report.moderatorId` → `User.id` | SET NULL | `Report_moderatorId_fkey` |
| `Report.reporterId` → `User.id` | SET NULL | `Report_reporterId_fkey` |
| `Report.targetUserId` → `User.id` | SET NULL | `Report_targetUserId_fkey` |
| `ReportModerationAction.reportId` → `Report.id` | RESTRICT | `ReportModerationAction_reportId_fkey` |
| `ReviewClaim.reviewId` → `ExpertReview.id` | CASCADE | `ReviewClaim_reviewId_fkey` |
| `ReviewClaimFeedback.claimId` → `ReviewClaim.id` | CASCADE | `ReviewClaimFeedback_claimId_fkey` |
| `ReviewDecision.reviewId` → `ExpertReview.id` | CASCADE | `ReviewDecision_reviewId_fkey` |
| `ReviewDecisionEvidence.assignmentId` → `ExpertAssignmentIdentity.assignmentId` | RESTRICT | `ReviewDecisionEvidence_assignmentId_fkey` |
| `ReviewDispute.(claimId, reviewId)` → `ReviewClaim.(id, reviewId)` | CASCADE | `ReviewDispute_claimId_reviewId_fkey` |
| `ReviewDispute.reviewId` → `ExpertReview.id` | CASCADE | `ReviewDispute_reviewId_fkey` |
| `Session.userId` → `User.id` | CASCADE | `Session_userId_fkey` |
| `Video.ownerId` → `User.id` | CASCADE | `Video_ownerId_fkey` |

Deletion behavior is structural, not a permitted purge order. RESTRICT remains relevant
even after assignments become terminal: cancellation does not remove expertId's User FK.
The assignment assignedById SET NULL special case is explicitly allowed by C031 triggers
without rewriting immutable creator evidence; a generic reassignment/actor reset is not.
Report identity SET NULL leaves sensitive reason text and retained moderation evidence;
account deletion therefore cannot promise reports disappear or retain them indefinitely.

### Relationships intentionally lacking a foreign key

| Table / fields | Required lifecycle analysis |
| --- | --- |
| AuditLog.actorId, subjectId | Polymorphic locators do not disappear with User/Video. Selected T10/T12 actions map actors to opaque ExpertActorIdentity subjects and have scoped immutability in addition to SAFETY protections. Other actions keep their existing semantics; no universal anonymity or retention approval follows. |
| AssignmentEvent.assignmentId, snapshot, actorEvidence | Retained event has no live assignment FK; snapshot may still contain video/subject references. Must preserve approved minimal evidence without claiming anonymity. |
| ExpertAssignmentIdentity.assignmentId | Immutable ID tombstone survives live assignment removal; prevents ID reuse. No User/Video cascade. |
| ExpertActorIdentity.subjectId; ExpertCredentialApproval/Event.subjectId | Independent actor/credential evidence survives live mapping. Approval/evidence JSON and event reason require minimization/retention decisions. |
| AssignmentIdempotency.actorSubjectId, response, fingerprint | Actor reference has no live User FK; receipt has restrictive identity FK and immutable result. Retention/replay scope needs approval; don't fabricate an FK cascade. |
| VideoCleanupTask.videoId, bucket, objectKey, uploadKey | Deliberately no live FK: durable private cleanup survives deletion. Purging before provider verification loses recovery locators. Approved locator minimization after completion is not implemented. |
| VideoWithdrawalReceipt.withdrawalTaskId | No SQL FK. Consumer receipt must not be mistaken for physical cleanup or all-consumer completion. |
| AssignmentCancellationScan.afterId, throughId | Mutable scheduling references only, no FKs; never completion evidence or authorization. Source removal must preserve eventual fair reconciliation. |
| AssignmentModeratorScope.moderatorSubjectId; AssignmentModeratorGrantEvent.actorEvidence | No live User FK. Queue authority requires the current scope/expiry and live trusted identity checks; closure must revoke scope through the agreed lifecycle/events, not delete immutable scopes or events. Retained subject/evidence still needs minimization policy. |
| ExpertReview.qaById; ReviewDecision.moderatorId/reason | Live QA identity/feedback has no User FK. Video tombstoning removes live decisions and clears qaById/qaFeedback; retained opaque decision evidence is separate. Closure still needs an approved minimization and handoff sequence. |
| ReviewDecisionEvidence.reviewId/moderatorSubjectId | No live review/moderator FK. Immutable minimal evidence survives live source deletion through the retained assignment-identity FK; this requires an explicit retention/hold/purge decision. |
| ReviewDispute.ownerId | Scalar owner locator, no User FK. Review/claim cascades can delete live disputes; source-loss closure does not by itself implement account-closure retention or erase reasons/resolutions. |
| MatchPair.userLowId, userHighId, reasons | Scalar account references, no User FKs; rows may outlive either User. Matching consumer purge/denial is not implemented by account cascade. |
| MatchDecision.actorUserId | No User FK; only pair cascade exists. Close/delete must not leave accessible historical decisions by accident. |
| ConsentPolicyEvidence.content/digest | Intentionally retained exact policy snapshot, not a live user profile. Do not rewrite approved bytes or infer indefinite retention. |

### SQL trigger constraints beyond Prisma relations

| Table | Actual non-internal triggers (61 total) |
| --- | --- |
| `AssignmentCancellationContext` | `AssignmentCancellationContext_binding`, `AssignmentCancellationContext_immutable`, `AssignmentCancellationContext_no_truncate`, `AssignmentCancellationContext_recorded_at` |
| `AssignmentEvent` | `AssignmentEvent_binding`, `AssignmentEvent_immutable`, `AssignmentEvent_no_truncate`, `AssignmentEvent_recorded_at` |
| `AssignmentIdempotency` | `AssignmentIdempotency_immutable`, `AssignmentIdempotency_no_truncate` |
| `AssignmentModeratorGrantEvent` | `AssignmentModeratorGrantEvent_binding`, `AssignmentModeratorGrantEvent_immutable`, `AssignmentModeratorGrantEvent_no_truncate` |
| `AssignmentModeratorScope` | `AssignmentModeratorScope_event_required`, `AssignmentModeratorScope_mutation`, `AssignmentModeratorScope_no_delete`, `AssignmentModeratorScope_no_truncate` |
| `AssignmentWithdrawalReceipt` | `AssignmentWithdrawalReceipt_immutable`, `AssignmentWithdrawalReceipt_no_truncate`, `AssignmentWithdrawalReceipt_recorded_at` |
| `AuditLog` | `AuditLog_safety_immutable`, `AuditLog_safety_no_truncate`, `AuditLog_t10_actor_subject`, `AuditLog_t10_delete`, `AuditLog_t10_update`, `AuditLog_t12_actor_subject`, `AuditLog_t12_delete`, `AuditLog_t12_update` |
| `ConsentEvent` | `consent_event_immutable`, `consent_event_no_truncate` |
| `ConsentPolicyEvidence` | `consent_policy_immutable`, `consent_policy_no_truncate` |
| `ExpertActorIdentity` | `ExpertActorIdentity_delete`, `ExpertActorIdentity_immutable`, `ExpertActorIdentity_no_truncate` |
| `ExpertAssignment` | `ExpertAssignment_event_required`, `ExpertAssignment_identity_guard`, `ExpertAssignment_review_generation`, `ExpertAssignment_write` |
| `ExpertAssignmentIdentity` | `ExpertAssignmentIdentity_immutable`, `ExpertAssignmentIdentity_no_truncate` |
| `ExpertCredential` | `ExpertCredential_delete`, `ExpertCredential_event_required`, `ExpertCredential_no_truncate`, `ExpertCredential_write` |
| `ExpertCredentialApproval` | `ExpertCredentialApproval_immutable`, `ExpertCredentialApproval_no_truncate` |
| `ExpertCredentialEvent` | `ExpertCredentialEvent_binding`, `ExpertCredentialEvent_immutable`, `ExpertCredentialEvent_no_truncate`, `ExpertCredentialEvent_recorded_at` |
| `ReportModerationAction` | `ReportModerationAction_immutable`, `ReportModerationAction_no_truncate`, `ReportModerationAction_recorded_at` |
| `ReviewDecision` | `ReviewDecision_guard_delete`, `ReviewDecision_immutable`, `ReviewDecision_no_truncate`, `ReviewDecision_record_evidence` |
| `ReviewDecisionEvidence` | `ReviewDecisionEvidence_immutable`, `ReviewDecisionEvidence_no_truncate` |
| `Video` | `Video_remove_live_qa_details` |

ConsentEvent/ConsentPolicyEvidence reject UPDATE/DELETE/TRUNCATE. Credential approvals,
credential events, AssignmentEvent, assignment identity/idempotency and C051 context/
receipt also enforce immutable evidence. Actor/credential live mappings cannot be
deleted/recreated while User still exists; parent User cascade is the controlled
technical exception. Credentials and assignments require a matching event in the same
transaction, exact revision progression and immutable approval/consent binding. These
triggers are not a lifecycle implementation. No request may reset identity by deleting
and recreating rows or truncate protected history.

The current cascade path User → Video → ExpertAssignment → ExpertReview → observation/
claim/dispute can remove downstream material before provider cleanup and before future
review retention is reconciled. Conversely ExpertAssignment.expertId prevents deleting
an expert User while any live assignment row references it. A lifecycle design must
resolve these deliberately, never assume every User delete succeeds or that schema
cascade alone is the intended privacy behavior.

## Unavailable consumers and pending work

| Dependency | Current boundary / required follow-up |
| --- | --- |
| C035 queue/grant foundation (PR18 merged) | Included in the 50-FK / 61-trigger inventory. Scope binds retained assignment identity, with a deferred currentGrantId FK and immutable self-referencing grant events. User deletion does not cascade scopes/events. Plan explicit revocation and membership handoff; role alone grants no queue access. Trusted provisioning/MFA and external grant management remain production gates. |
| T08 draft API (PR22 merged) | Actual draft initialization/read/save and backend duration retry now exist. Include their account/generation checks, positive version and ordered timecode constraints (legacy rows remain NOT VALID), and late duration-probe identity reconciliation. This contract does not certify those races. Merged T10/T12 submission, QA and claims are included below; their existence does not complete account closure. |
| T10/T12 review, QA, claims and disputes (PR29/30 merged) | Real APIs enforce source/generation authorization. Source loss closes disputes, tombstoning minimizes live QA details, and selected review/claim/dispute audits plus decision evidence remain protected. Account-closure handoffs, receipts, approved retention and full closure races are not implemented by those source-loss guarantees. |
| Matching (PR31 still open) | Do not import unapproved code or fabricate consumer acknowledgement. Closure needs access denial, derived-data invalidation, cache/in-flight handling and an agreed durable acknowledgement contract. |
| C062 reciprocal blocking integration | Review consumers now use the merged reciprocal-block checks. Matching remains unmerged; neither consumer has an implemented C065 barrier/closure acknowledgement. Do not claim full account-closure integration. |
| Staff MFA/provisioning and policy publication | Default fail-closed. No NODE_ENV/test evidence, role claim or invented approval may enable ordinary-runtime private access. |
| Backup/hold/retention and status authentication | Not approved or implemented. Production purge and C066 final completion remain blocked. |

## Decisions requiring explicit agreement before implementation

| Decision | Owners / concrete question |
| --- | --- |
| D1 scope and proof | Huong + product: MEMBER self-service only initially? Exact reauthentication/freshness and confirmation? How are staff/expert accounts deprovisioned without harming others' media? |
| D2 access barrier | Huong + Phuc: separate closure ledger and exact AccountStatus mapping, transaction helper boundary, and all consumer checks? No overload of SUSPENDED without agreement. |
| D3 assignment effects | Phuc + Huong: closing-expert cancellation/revocation reason and immutable initiator contract, moderator ownership handoff, lock/CAS and full edit/submit/QA races? C051 owner reasons remain unchanged. |
| D4 durable work | Both: per-consumer acknowledgements and missing-lineage reconciliation; all source mappings retained until whose receipt? How are permanent failures escalated without false completion? |
| D5 minimization and holds | Authorized policy/product owners + both engineers: evidence-by-evidence retention/purpose, allowed identifying fields, legal hold authority, expiry/review and approved purge mechanism? No duration chosen here. |
| D6 backups | Operations + both: retention, encrypted key custody, post-backup restriction journal/replay, restore isolation and proof that expired backups cannot revive access? |
| D7 status and errors | Huong + Phuc: how does a signed-out owner authenticate status, reconcile an uncertain commit, recover access to the operation and avoid enumeration? Exact response/429/idempotency retention contracts? |
| D8 undo and copy | Product + both: any cancellation/reopening window, restrictions that never auto-revive, approved user copy for remaining evidence/backups/downloaded bytes? |
| D9 release evidence | Both + operations: tested outages, late-capability cleanup, concurrency and crash-restart matrix, supported workload/monitoring destination and named incident owner? |

## Validation and handoff

PASS: documentation inventory reconciled with Prisma schema, all migration DDL and the
fresh PostgreSQL catalog (50 FKs / 61 triggers); no runtime/schema/secret changes.
The referenced C095 synthetic backup/restore evidence is an independent deliverable,
not a new execution of account closure. NOT RUN: any account closure/purge API, lifecycle
state transition, C066 UI, production retention/deletion, backup restriction replay or
unmerged downstream end-to-end workflow. Those are intentionally not implemented.

Before C065 code: obtain explicit decisions above, refresh the inventory against the
then-current develop, and review the transaction/worker/authorization contracts with
Phuc. Keep this proposal distinguishable from implemented guarantees in all handoffs.

## Refresh and traceability

The original proposal used the pre-C035 catalog. This refresh includes all 22 currently merged migrations, 50 FKs and 61 non-internal triggers, verified by the separate synthetic restore rehearsal. C035 scope/grant tables cannot be purged via User deletion; their immutable lifecycle and deferred circular FK need a separately approved retention/revocation design. PR22 draft constraints preserve legacy rows with NOT VALID checks; their existence is not proof all historical rows satisfy the new checks.

The private commit plan assigns C065 to T11. The initial documentation commit/PR body incorrectly labeled T12; this document and follow-up traceability correct that to T11 without rewriting published history. No account closure or purge is implemented.

This merge refreshes the proposed record against merged T10/T12 and PR24/25/26. The inventory includes ReviewDecision, retained ReviewDecisionEvidence, ReviewClaimFeedback, composite dispute provenance, T10/T12 actor/audit guards and source-loss cleanup. D1–D9 remain unapproved implementation decisions; merging this documentation does not authorize closure code, policy publication, retention periods or hard deletion.
