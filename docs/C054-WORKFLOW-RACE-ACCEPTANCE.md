# C050 / C053 / C054 integrated privacy acceptance

Baseline: develop `20aaea8`, including T08, T10, T12 and T14. This is synthetic
security acceptance, not production policy/MFA approval or a final-erasure claim.

## Scope and method

`full-workflow-races.integration-spec.ts` adds 70 deterministic orderings across
VIDEO_STORAGE withdrawal, EXPERT_VIDEO_REVIEW withdrawal and owner deletion.
The two existing DELETE/playback orderings in `security-media.integration-spec.ts`
complete the 12-operation by three-restriction by two-order matrix. Three more
cases cover concurrent cancellation scans before/after the producer commit.
Two real-capability/cold-process cases cover late PUT, outage and cleanup retry.

The operation set is expert playback, draft initialization/read/edit, submission,
independent QA read/return/approval with claim creation, owner claim confirmation,
sharing, owner report projection and matching claim/recommendation projection.

The first real Prisma transaction executes its actual application callback and
then pauses before COMMIT. The competing HTTP request must be observed waiting
on that backend via `pg_blocking_pids`. Tests preserve transaction isolation and
domain lock order. For queue visibility tests, scanners finish while producer
work is uncommitted and must create no cancellation/acknowledgement for it.
No authorization result, session handler or SQL business mutation is mocked.

Fixtures use real Argon2 login, cookies, controllers, services, PostgreSQL,
MinIO upload/confirmation and native FFprobe-measured duration. The MP4 is a
generated black synthetic test clip; its scripted review text is test data,
not a human assessment or verified claim about a real member. Policy,
qualification and session-specific staff proofs are explicitly testOnly sources
in disposable schemas/buckets. Ordinary-runtime providers remain closed.

Each synthetic account uses its own actual loopback source address. This avoids
charging hundreds of distinct fixture users to one NAT login quota. Origin,
JSON, session, role, quota and proxy checks remain enabled; no forwarded-IP
header or successful Auth replacement is used.

## Expected restriction semantics

An operation serialized before restriction may complete and return previously
authorized data. Once restriction commits, new expert playback/edit/submit/QA
and owner claim mutation fail closed. Owner report reads can legitimately
return an empty result. Media withdrawal removes media-derived matching reasons;
independent PROFILE_MATCHING consent can still authorize a profile-only card.
Tests must not silently turn an optional video grant into mandatory matching.

Regrant never revives an old source generation. Completed assignments stay
COMPLETED; active ASSIGNED/IN_PROGRESS/SUBMITTED work is cancelled once using
current revision CAS and immutable events. A C051 receipt does not complete
the shared withdrawal task on behalf of absent consumers.

Audit assertions require one successful action only when that action committed,
no successful action for denied work, rollback compatibility and exclusion of
private summaries/transcripts/feedback, password hashes and session bearers.
Existing C053/T10/T12 tests retain their stronger injected audit-failure and
provider-diagnostic controls. This PR does not invent per-target denial events;
the owner decision record must distinguish denial telemetry from access grants.

## Actual capability lifetime and process recovery

The late-upload test deletes an owned video, verifies final-object absence with
real MinIO HEAD, then uses its genuine still-valid PUT capability to recreate
private staging bytes. API access remains denied and cleanup stays PENDING.
It does not modify signed expiry, forge HEAD or call a receipt proof of erasure.

The suite waits for the actual 300-second upload capability to expire. A
test-owned scheduling deferral preserves that pending task during the matrix;
making the retry due changes only scheduling, never authorization or completion.
A separately started application worker first receives a real refused MinIO
connection: attempts increase and no completion is acknowledged. A new process
with restored native storage removes/rechecks final and staging objects, commits
completion only after verification, and does not duplicate cancellation evidence.
The child refuses non-test, non-loopback or non-disposable schemas/buckets.

Previously issued playback URLs remain bearer capabilities until expiry or
provider removal. Existing C085 tests demonstrate that limitation explicitly.
No API can recall downloaded bytes or certify backup erasure through this suite.

## Run and remaining gates

API integration requires native PostgreSQL 18 on localhost:5433, native private
MinIO, FFmpeg and an absolute VIDEO_DURATION_FFPROBE path. API build precedes
the cold-process check. CI prepares the native decoder before integration and
retains the existing dedicated decoder/browser stages.

Run the API integration command with `--testPathPattern=full-workflow-races`.
Allow the real upload capability to expire; do not replace that wait with a
forged clock/expiry or weaken authorization to shorten the run. Companion
controls are security-media, privacy-audit, assignment-access, review-claims and
assignment-cancellation suites. The PR records actual PASS/FAIL/SKIP outcomes.

C050/C053 acceptance must be reconciled against these actual merged consumers;
production MFA, approved published policy, retention/purge authority, maintained
storage, deployed topology and backup restriction replay remain separate gates.
This file approves none of those external conditions.

Local acceptance: PASS all 75 new cases in one complete run, including genuine PUT expiry, real MinIO refusal/recovery and cold worker processes; PASS Prisma validate/generate, 336 unit tests (native decoder enabled), API/web production builds and TypeScript/lint. Initial setup/quota failures were corrected in test configuration/real-client isolation, without changing application authorization or limits. Fresh Node24 CI and companion-suite outcomes are recorded in the PR.
