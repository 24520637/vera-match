# Privacy and lifecycle owner decisions — version 1.1

Status: **OWNER TECHNICAL DECISION FINALIZED**, 2026-11-22, Huong / T11.
Baseline: develop 20aaea8 (T08/T10/T12/T14 and C051 merged). This record supersedes the unresolved product proposals in C065-ACCOUNT-LIFECYCLE-CONTRACT.md. It authorizes engineering implementation, not publication of policies, legal retention, production provisioning or a final-erasure claim. Code and test PRs must report their own implemented scope.

For every C1–C6 below: **DECIDED BY HUONG / OWNER DIRECTIVE**. No unanswered integration acknowledgement prevents Huong-owned implementation.

## C1 — Independent consent and exact draft notices

All five actual ConsentPurpose values remain independently optional and OFF by default. A dependent feature may be unavailable without its necessary grants; unrelated grants must never be bundled. Server authorization requires current state, approved evidence and the original generation binding. Regrant creates current permission but never resurrects old assignments, reports, handles or matching decisions. Withdrawal must work without a currently published grant policy.

| Purpose | Authorized processing / feature dependency | Withdrawal and retained evidence |
| --- | --- | --- |
| PROFILE_MATCHING | Use eligible profile/preferences/questionnaire projections to produce profile-based recommendations and member decisions. Does not authorize private media or report sharing. | Stop new discovery/acceptance; invalidate old generation-bound matching authority. Existing immutable decision evidence follows C2; no automatic pair restoration. |
| VIDEO_STORAGE | Store and serve the member's private video through owner-authorized APIs. Necessary for recording/upload/storage, not permission to publish. | Deny new issuance/confirm immediately; durable tombstone, C051 and provider-verified staging/final cleanup asynchronously. Issued capabilities have bounded residual validity. |
| EXPERT_VIDEO_REVIEW | An assigned, currently qualified and authorized expert may view and review this video; authorized QA may process the review under its separate assurance contract. | Stop new playback/edit/submit/QA/source-derived claim access; C051 cancels non-terminal assignments. Historical immutable evidence is restricted, not rewritten. Video retention independently follows VIDEO_STORAGE. |
| REPORT_SHARING | Permit sharing only selected report-derived factual claims that the member separately confirms and explicitly shares. No public full report and no personality inference. | Stop future selected-claim projection, including dependent matching reasons; retain restricted decisions/evidence under C2. Owner access to a private report still depends on valid original video/review source. |
| VIDEO_CLAIM_MATCHING | Permit those confirmed/shared factual video claims to contribute allowed reasons to matching, additionally requiring PROFILE_MATCHING and REPORT_SHARING. | Remove report-derived reasons and deny stale claim-based authority. Independent profile-only matching may remain authorized. |

The existing registry returns undefined. **Keep it unpublished**. No environment flag or testOnly fixture can publish these drafts. Real grants require the authorized owner's explicit approval of the exact localized content, privacy/legal basis and release conditions. Grant copy below is a product draft, not legal advice or a claim of compliance.

Initial immutable draft version: **2026-11-22.v1-draft**, locales **en** and **vi**, independently versioned per purpose. Before publication, assign a non-draft version and bind the exact UTF-8 text, locale and SHA-256 digest to immutable ConsentPolicyEvidence. Never mutate a published snapshot; substantive processing changes require a new version and explicit re-consent. No silent migration of historical grants.

| Purpose | English draft notice | Vietnamese draft notice |
| --- | --- | --- |
| PROFILE_MATCHING | I allow VERA Match to use my eligible profile, preferences and questionnaire answers to suggest matches and process my matching choices. This is optional. Turning it off stops new matching authorization; previously recorded decisions may be retained with restricted access under the retention policy. | Tôi cho phép VERA Match dùng hồ sơ đủ điều kiện, sở thích và câu trả lời bảng hỏi của tôi để gợi ý kết nối và xử lý lựa chọn kết nối. Đây là lựa chọn không bắt buộc. Khi tắt, hệ thống ngừng cấp quyền kết nối mới; bằng chứng lựa chọn đã ghi có thể được giữ với quyền truy cập hạn chế theo chính sách lưu trữ. |
| VIDEO_STORAGE | I allow VERA Match to store my private video and provide authorized private playback. This does not make it public. Turning this off stops new API access and starts verified cleanup. Links already issued may work until their short expiry; deletion is not instant and retained evidence or backups follow the retention policy. | Tôi cho phép VERA Match lưu video riêng tư và cung cấp phát lại khi có quyền hợp lệ. Video không trở thành công khai. Khi tắt, hệ thống ngừng cấp quyền truy cập API mới và bắt đầu dọn dẹp có xác minh. Liên kết đã cấp có thể dùng đến lúc hết hạn ngắn; việc xóa không tức thì và bằng chứng hoặc bản sao lưu được giữ theo chính sách lưu trữ. |
| EXPERT_VIDEO_REVIEW | I allow an assigned, authorized expert to review my private video and authorized quality reviewers to check that review. This does not authorize personality inference or public sharing. Turning it off stops new review access and cancels eligible assignments; restricted historical evidence may remain under the retention policy. | Tôi cho phép chuyên gia được phân công và có quyền hợp lệ đánh giá video riêng tư, cùng người kiểm tra chất lượng có quyền kiểm tra đánh giá đó. Việc này không cho phép suy đoán tính cách hoặc chia sẻ công khai. Khi tắt, hệ thống ngừng cấp quyền đánh giá mới và hủy các phân công còn đủ điều kiện; bằng chứng lịch sử có thể được giữ với quyền hạn chế theo chính sách lưu trữ. |
| REPORT_SHARING | I allow only factual claims from my reviewed report that I separately confirm and choose to share to be shown in supported matching features. My full report and video are not published by this choice. I can turn this off to stop future sharing; restricted historical evidence may remain. | Tôi chỉ cho phép những thông tin thực tế từ báo cáo đã kiểm tra mà tôi xác nhận riêng và chủ động chia sẻ được hiển thị trong tính năng kết nối được hỗ trợ. Lựa chọn này không công khai toàn bộ báo cáo hoặc video. Tôi có thể tắt để ngừng chia sẻ về sau; bằng chứng lịch sử có thể được giữ với quyền hạn chế. |
| VIDEO_CLAIM_MATCHING | I allow my separately confirmed and shared factual video claims to be used for supported matching reasons. Profile matching and selected-report sharing must also be enabled. Turning this off removes future claim-based matching authorization without changing an independent profile-matching choice. | Tôi cho phép các thông tin thực tế từ video mà tôi đã xác nhận và chia sẻ riêng được dùng làm lý do kết nối được hỗ trợ. Kết nối bằng hồ sơ và chia sẻ thông tin từ báo cáo cũng phải được bật. Khi tắt, hệ thống ngừng cấp quyền kết nối dựa trên thông tin video, không thay đổi lựa chọn kết nối bằng hồ sơ độc lập. |

Notice requirements: show the exact purpose, optional unticked control, current version/locale, feature dependencies, withdrawal action, capability residual lifetime, retention summary and restricted support route before the explicit grant. Record the exact displayed snapshot; do not claim informed approval from a hidden checkbox. The current PATCH API accepts purpose/granted/policyVersion, not a locale selector: publication needs a reviewed registry/client contract binding the displayed locale, or a single explicitly displayed approved locale. Do not claim bilingual publication is already implemented.

Acceptance: each independent grant/withdrawal, unsupported policy/version, testOnly runtime rejection, immutable digest checks, regrant generation isolation and removal of derived matching reasons. C054 PR #32 proves the integrated source-loss matrix; C062 adds block integration separately.

## C2 — Concrete minimization and retention defaults

Defaults below are engineering review targets, **not legally mandated durations**. Production retention enforcement requires authorized compliance/owner approval and a real hold registry. No hard deletion, immutable-evidence purge or backup destruction may run solely because this document selects a number. Immediate denial and approved existing object cleanup continue independently.

| Data category | Selected engineering default / trigger | Restricted evidence and final verification |
| --- | --- | --- |
| Live profiles/preferences/questionnaire | Deny at closure commit; target minimization within 24 hours after genuine domain handoff. | Preserve only approved evidence references; domain consumer receipt required before claiming minimized. |
| Video staging/final | Deny new API access at restriction; cleanup target 1 hour after the last genuine upload capability expires, with bounded retry and outage escalation. | Actual provider DELETE plus HEAD absence for both locations; no completion while expiry/outage/unknown remains. No change to C051/media durable receipts. |
| Upload/playback capabilities | Current maximum PUT 300 seconds; GET 60 seconds, additionally bounded by session/assignment/qualification. | Cannot revoke bytes already delivered or an issued bearer URL by changing DB state; never log URLs. |
| Consent grants/events/policy snapshots | Keep current state while eligible; withdraw on closure. Review minimal immutable evidence at 24 months after last restriction. | Preserve exact historical policy snapshot and subject/version lineage; production purge needs approved legal basis and immutable-storage-compatible procedure. |
| Sessions/auth/recovery/status tokens | Revoke/consume at restriction; expire naturally per existing configured TTL. Purge expired hash-only secret rows after 30 days where no evidence reference requires retention. Status capability 15 minutes, renewal window 30 days. | No raw secrets. A revoked session is never restored from a closure status token. Purge job is not authorized by this provisional default. |
| Assignment identities/events/approvals | Cancel eligible owner assignments; keep terminal history restricted. Review at 24 months after terminal transition. | CAS and immutable actor/context evidence survive live identity changes. Staff deprovisioning is separate. |
| Review drafts/QA/evidence | Deny new reads/mutations at source loss; target mutable draft minimization within 24 hours after acknowledged closure handoff. Review immutable evidence at 24 months. | Preserve genuine QA decision lineage; no historical rewrite or fake consumer receipt. |
| Claims/annotations/disputes | Stop publication immediately; mutable minimization target 24 hours after safe handoff, unresolved disputes reviewed every 30 days. Review restricted immutable resolution evidence at 24 months. | Dispute obligation does not authorize continued publication or media access. |
| Matching pairs/decisions | Invalidate access immediately; review minimized decision evidence 90 days after final invalidation. | Never resurrect old handles/pairs after unblock/regrant/closure. New eligible recommendations require fresh authorization. |
| Blocks/reports/moderation | Keep active safety restriction as needed without exposing report text. Review retained case evidence 180 days after final case closure; unresolved cases every 30 days. | Safety owner determines minimum evidence; no public report lookup or HTML rendering. No indefinite retention merely because a trigger prevents modification. |
| Cleanup/cancellation/closure receipts | Retain until all consumers, outstanding capabilities and backup windows reconcile; review minimal evidence at 24 months. | Separate per-consumer completion from total completion; unknown remains pending. |
| Application logs | 14-day rotating target, strict code-only failure telemetry. | No content, account references, keys, signed URLs or raw DB/provider payloads. Security incident evidence separately approved and access controlled. |
| Backups/replicas | Proposed encrypted daily backups: 7 daily plus 4 weekly, maximum 35-day normal recovery window; replicas inherit current access restrictions. | Actual expiry and independent journal reconciliation required before final purge assertion. These are approval-dependent targets, not evidence that a production backup exists. |

Legal holds require a named authorized owner, recorded scope, reason, review date and access controls; do not invent one or treat absence of a hold provider as permission to purge. A hold never reopens ordinary access. Physical erase, minimized retained evidence, backup expiry and downloaded external copies are distinct statements.

## C3 — MEMBER closure and atomic restriction

Choose MEMBER-only self-service closure. ADMIN cannot close others through this API. EXPERT/MODERATOR/ADMIN use separately reviewed staff deprovisioning, including credential, queue and third-party assignment duties. Historical staff responsibilities also require that route. Do not mistake an opaque actor subject for proof that a member was staff.

Protocol: POST /api/account-closure with exact confirmation CLOSE MY ACCOUNT, current password, expectedRevision 0 and a UUID Idempotency-Key. Derive identity exclusively from the server session. Verify password freshly on every accepted request; no password storage/logging, no client email/userId authority. Use a separate CLOSED AccountStatus and durable unique closure ledger; never overload SUSPENDED and never call User.delete().

State machine: accepted closure atomically enters RESTRICTED with revision 1 and durable consumer work. Reconciliation may enter RETENTION_PENDING only when every required live-data consumer truly acknowledges; final purge has no implemented/approved transition. Retry/failure/hold are conditions, never reopening. No automatic undo. 202 means access restricted and cleanup pending, not all copies erased. No endpoint may set CLOSED back to ACTIVE.

Atomic transaction: lock User, revalidate fresh password hash, live Session and MEMBER status; create closure identity/idempotency/audit; use the authoritative Consent transaction core to write OFF events for all actual five purposes and generation-bound durable withdrawal tasks; revoke all ordinary sessions and unused reset/verification tokens; set CLOSED. Roll back everything if any write/audit fails. No SMTP/MinIO I/O inside these locks. Consent withdrawal is not blocked by missing policy publication. Preserve immutable consent evidence and do not complete shared withdrawal tasks on behalf of absent consumers.

Use existing C051 and private-media durable workers for bounded owner-assignment cancellation and video tombstone/cleanup. This avoids holding every video lock in a long user transaction. Immediate denial is established by CLOSED plus authoritative OFF/generation checks, not a worker promise. Tests must exercise stale pre-authorized requests waiting behind the barrier across Auth, member, upload/confirm, playback, Review/QA/Claims and Matching. Active assignments cancel with real CAS/events and original withdrawal provenance; terminal assignments stay terminal.

Lock order remains sorted Users → Session → sorted Videos → ExpertCredential where needed → sorted Assignments. Never acquire the owner's User after holding a Video or Assignment. Reconciliation must recheck closure revision/barrier; don't call public services in nested transactions.

Receipts: unique closure identity per user, hash of idempotency key and canonical payload fingerprint, server timestamp, monotonic revision, immutable ACCEPTED event, per-consumer PENDING/ACKNOWLEDGED receipt with bounded sanitized status codes. Repeated authenticated in-flight same key/payload returns the same receipt; changed key payload conflict never reopens. After barrier commit, ordinary credentials are revoked and cannot be retained just for replay. Timeout after commit is uncertain: use C4, never automatic resubmission with a new key.

Current pre-closure baseline has **23 additive migrations, 50 foreign keys, 65 non-internal triggers** as measured by the real C095 catalog/restore on 20aaea8. T14 added MatchPair/Decision identity and immutability rules. Refresh the live catalog after each lifecycle migration; the old 22/50/61 inventory is historical. Referential cascades are not a business deletion plan. Preserve assignment/expert identity, consent evidence, audit, report SET NULL semantics, cancellation/cleanup locators and matching immutable history.

Acceptance: cross-role/owner denial, missing/wrong password and malformed confirmation, key conflict, exact single receipt/event, transaction rollback, concurrent closure and domain operations, all sessions/tokens revoked, worker outage/restart and genuine media verification. Overall lifecycle remains PARTIAL until missing consumers and purge/backup gates are satisfied.

## C4 — Restricted status after logout

Revoke all normal sessions. Email the previously verified address a separate 256-bit random base64url capability, persisted SHA-256 hash only, expiring in **15 minutes**. Link uses /closure-status#token=…; never put the secret in server query logs. The client clears the fragment and only consumes on an explicit status action, not email-prefetch/page-load. No localStorage/sessionStorage persistence and no full application session issued.

POST /api/account-closure/status consumes one valid token atomically and returns only state, revision and pending/retention indication. No user ID, email, request ID, private content, provider locator, report evidence or detailed consumer record. Missing/invalid/expired/replayed tokens receive the same generic rejection. All tokens for that closure are consumed together after a valid check.

POST /api/account-closure/status-email accepts an address solely to request delivery, returns the same generic 202 regardless of existence/eligibility; it is not a status lookup. Renewal allowed for 30 days after closure, 60-second minimum interval, at most 3 deliveries per 15 minutes and 3 unexpired capabilities. API also uses IP quotas and exact Origin/JSON checks. Per-process limiter is MVP-only, not a multi-instance claim.

Create the token durably before SMTP without domain locks across I/O. Failed delivery does not reopen the account. An ambiguous SMTP acceptance or post-acceptance DB failure must leave an already emailed token usable until its own expiry/consumption. Do not invalidate a previously mailed link merely to issue another; a successful status consumption invalidates all. Worker restart/retry never renews an old token or creates a successful delivery receipt without proof. Losing the verified mailbox requires a separately reviewed support recovery process.

## C5 — Recovery fence and independent restriction journal

Recovery objectives selected as design targets: RPO 24 hours, RTO 4 hours; neither is production-certified or measured. Huong owns recovery/security, Phuc owns domain reconciliation correctness, an explicitly assigned operator owns deployment execution.

Backups must be encrypted with separately controlled keys; least-privilege backup role and isolated restore role, no app credential reuse. Store integrity manifest, migration set, catalog counts and immutable-evidence checks. Rotate keys after exposure and through a scheduled reviewed operation; test old-backup readability before retiring keys. Incident logs use codes/timestamps and restricted run references, never media/content/credentials. Native disposable-schema rehearsals are evidence of mechanics, not production ACL/encryption/PITR deployment.

**Required independent boundary:** before acknowledging a new irreversible access restriction, durably append an authenticated, monotonic PREPARED restriction intent to a journal outside the database/backups being restored; then commit the SQL restriction and append confirmation. PREPARED is conservative denial when SQL outcome is uncertain. Ordinary DB outbox-only publication is insufficient: loss before export plus restoration of an earlier backup would lose the restriction. No distributed success claim without verified journal durability.

Journal must cover closure, consent source/generation withdrawal, video tombstones and matching invalidations, use opaque subjects/minimal scope, signed sequence/checkpoints, replay deduplication and access-controlled encryption with independent credentials. A restored deployment starts behind a CLOSED recovery fence. Verify backup integrity and migrations/FKs/triggers, fetch and verify the independent journal through the current authenticated high-watermark, replay restrictions without reopening generations, then reconcile C051, media late PUTs/HEAD, Review/Claims and Matching. Fence opens only after measured checks and authorized operator approval.

The independent journal and production fence are **not currently implemented**. Production restore remains **BLOCKED / FAIL-CLOSED**. C095 must demonstrate safely that an old synthetic backup revives pre-restriction state, record that as the expected negative control, and explicitly refuse a lifecycle-safe recovery claim. If the journal is unavailable, unverifiable or stale, do not serve ordinary traffic; escalate, preserve evidence and retry in isolation. Restore cannot recreate absent restriction evidence by merely scanning the restored DB.

Outages: keep requests pending and workers retryable; no fake COMPLETE to drain a queue. Verify queue oldest age, retry attempts, provider absence and durable receipt in separate steps. Synthetic worker restart/storage refusal is tested, but actual deployment alerts must route to a named on-call before launch. Escalation targets: warn at 15 minutes of worker failure/backlog, page at 1 hour overdue capability-adjusted cleanup, incident at 24 hours unresolved. These are operational defaults requiring a real monitored deployment, not claims that paging exists.

## C6 — Domain handoffs and no resurrection

| Consumer / accountable integration | Required behavior and genuine receipt |
| --- | --- |
| Huong coordinator/Auth/Consent | Atomic CLOSED/OFF/session barrier, accepted receipt and immutable minimal audit; no full status session, no erasure claim. |
| Huong C051/media | Cancel active owner assignments with existing provenance/CAS/events; tombstone and verify final/staging absence after capabilities expire. Only acknowledge own scope. |
| Phuc Assignment/Queue | Deny closed owners/experts and stale generation/approval bindings; prevent creation and queue metadata leakage; revoke/minimize grants through actual grant events. Do not manufacture staff evidence or global access. |
| Phuc Review/QA | Deny source-lost reads/edit/submit/approve including stale in-flight contexts; preserve immutable decisions, minimize mutable drafts when approved, emit a durable closure-bound receipt only after actual reconciliation. |
| Phuc Claims/Disputes | Stop publication and matching projection, retain approved minimal dispute/QA lineage, distinguish unresolved obligations from active access. Never mark all closure complete. |
| Phuc Matching | Enforce ACTIVE/current PROFILE grant and source claim eligibility/bilateral blocks under locks; invalidate old handles/decisions, never auto-revive old pairs. Produce a real closure reconciliation receipt after minimization. |
| Huong Safety | Preserve private reports and immutable case evidence under approved retention, deny member access after closure; independent genuine acknowledgement after safe minimization, not on account status alone. |
| Operations/recovery | Independently durable restrictions, backup reconciliation, fence proof and approved expiry evidence; absent implementation remains BLOCKED. |

A consumer work item is keyed by closure ID and contract version, status PENDING until its own verified transaction/provider proof. Retry is idempotent; CAS/event/history invariants remain intact. Unknown or missing consumer remains pending. No domain receipt can promote total erasure. Do not fabricate historical events to retrofit a receipt. Explicit unblock may permit a fresh check of an otherwise valid expert assignment under the current block contract; it does not revive invalidated matching pairs, closed accounts or withdrawn generation bindings.

Privacy audit decision: successful sensitive domain authorizations and mutations retain their existing minimal atomic evidence; denied operations must not write a success event. Operational denial telemetry is aggregate code-only, never a per-target content log. No claim that a new universal per-target denial audit exists.

## Release and delivery classification

- OWNER TECHNICAL DECISION FINALIZED: C1–C6 in this record.
- IMPLEMENTED AND VERIFIED: only behavior supported by each linked code PR and executed tests.
- PARTIAL — EXTERNAL CONSUMER NEEDED: domain minimization/acknowledgement not yet implemented.
- BLOCKED — LEGAL / PRODUCTION APPROVAL: actual policy publication, final retention/purge authority, trusted staff assurance/provisioning, production independent journal/fence and measured operations.
- NOT RUN: any unexecuted deployment, provider or consumer test must stay explicitly labelled.

No real consent policy, legal hold, MFA provider, final purge or independent journal is created by this document. C065/C066 may be developed and tested with synthetic fixtures; production exposure requires explicit release approval and the missing recovery/privacy controls.

## Version 1.1 — concrete foundation consumer mapping

DECIDED BY HUONG / OWNER DIRECTIVE. Clarifies the version-1 decisions against the implemented C065 foundation in [PR #35](https://github.com/24520637/vera-match/pull/35), commit 3b03632; it does not publish consent policies or authorize purge. The proposed application tree now measures 24 migrations / 54 FKs / 76 non-internal triggers; the develop 20aaea8 baseline remains 23/50/65. C066 UI is PR #36 and the recovery negative control is PR #37, both stacked on C065.

The actual AccountClosureConsumer names are deliberately grouped contracts, not acknowledgements. ClosureReconciliationV1 identifies contractVersion 1, closureId, expectedClosureRevision and consumer; each domain must preserve its own genuine minimal receipt before an aggregate ACK. No public ACK API or implemented aggregate completion method exists. Current rows remain PENDING.

| Actual consumer name | Mandatory scope before a future genuine aggregate acknowledgement |
| --- | --- |
| MEDIA | Huong: C051 owner-assignment reconciliation/receipts plus video tombstones, outstanding upload capability reconciliation and provider-verified final/staging absence. A cancellation receipt alone is insufficient. |
| REVIEW_CLAIMS | Phuc: Assignment/Queue access and historical grant disposition, mutable review minimization, QA evidence, claims/annotations/disputes and their approved retained evidence. Every relevant subdomain needs a genuine closure-bound receipt; missing one keeps this aggregate PENDING. |
| MATCHING | Phuc: **both T04 member data (Profile, Preferences, Questionnaire) and T14 pairs/decisions/handles**. Reconcile authorized minimization with resource revisions and retained evidence; matching pair invalidation alone cannot acknowledge member-data cleanup. Preserve no-resurrection rules and actual domain CAS/history. |
| SAFETY | Huong: blocks, private reports/moderation and approved retained case evidence/minimization, with actual owner-authorized retention review. |
| RECOVERY | Operations: independent restriction journal/checkpoint/fence, backup/replica reconciliation and approved expiry evidence. Currently BLOCKED; an isolated successful SQL restore is not this receipt. |

C065 currently adds the global CLOSED/OFF barrier, explicit restrictive ledger and real C051/media handoff, and filters closed-owner queue metadata. It does **not** implement the aggregate consumers above. Phuc must not call a non-existent ACK endpoint or mark a group complete from one subdomain. The expected revision and receipt ownership must be rechecked under the existing lock order; no fabricated historical event.

Grant history is not rewritten to mimic a staff revocation: an owner closure does not manufacture ADMIN/MODERATOR/MFA identity. Existing CLOSED/source-loss checks must deny ordinary access immediately. Retained grant/event history may be recorded as restricted by the closure barrier in a genuine domain receipt. If an actual grant REVOKED transition requires a new system-actor contract, implement/review that contract explicitly before emitting it; never call the public staff flow with forged assurance.

The previously verified delivery address is retained solely as the restricted status channel during the 30-day renewal window; no normal session or email-rebinding API follows. After that window, queue identity minimization for the approved lifecycle procedure; **no automatic purge is implemented/authorized**. Current CLOSED identity guards intentionally reject silent email/verification/password/role rebinding, so a future approved minimization/support procedure must preserve the durable barrier and historical evidence explicitly. Retaining a live FK is not permission to retain identifying email indefinitely.

Native background-tab visibility acceptance for C062 remains PARTIAL in the current headless runner (both tabs stay visible); real HTTP history/refocus cases pass. Huong owns that platform acceptance, not a missing Phuc Matching API. Production MFA/provisioning, published policies, legal retention authority and the independent journal remain external release gates.

## Version 1.2 — signed policy publication integration

DECIDED BY HUONG / OWNER DIRECTIVE, 2026-11-23. Technical candidate 2026-11-23.v1 uses the exact EN/VI notices above. The runtime now supports only operator-installed Ed25519-approved, version/locale/digest-bound snapshots; an absent approval remains unpublished, and no draft/boolean enables a real grant. This is not legal approval of publication. See CONSENT-POLICY-PUBLICATION.md for the signed authority, immutable snapshot, publication lifetime, controlled single-process activation and user review contract.

Member grant requests bind the exact displayed locale and UTF-8 digest. Existing withdrawal/idempotency/generation lineage is preserved; withdrawals never consult current publication. Source authorization rejects an absent, expired or changed current real policy, while historical evidence remains immutable. Re-consent does not remove earlier withdrawal tasks or revive stale assignments, claims or matches.

C062 native background acceptance is now verified by the merged PR #33 and its exact-head CI, superseding the historical headless-only PARTIAL note above. C065 consumer completion, retention/legal authority, staff production assurance and the independent recovery fence still require their own actual implementation/evidence; this policy change does not mark them done.
