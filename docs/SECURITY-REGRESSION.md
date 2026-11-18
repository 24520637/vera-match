# T15 security regression — independently verifiable subset

Branch: huong/test/security-regression. Baseline: a14ae10 (develop).
This is not Feature 06 completion or production approval. Private execution
instructions and the archived commit plan are not repository deliverables.

## Dependency inspection

- PR #17 is merged: C034 timezone-fixture correction is included.
- PR #19 is merged: real C051 cancellation/evidence/rotation/observation is included.
- PR #18 (C035/PA2) and PR #20 (C036 races) remain unmerged at this inspection.
  Their changes are not imported. PA2 HTTP administration/provisioning is not a
  tested merged API. The PR #18 provider-boundary fix belongs to that PR.
- Review workspace/submit/independent QA/report/claims/matching APIs and account
  deletion remain absent. A Prisma model or a missing route is not an API test.

## Planned-step accounting

| Step | Implemented evidence | Status / missing acceptance |
| --- | --- | --- |
| C083 | Cross-feature session/IDOR matrix, real login anti-fixation, real Mailpit reset and all-session revocation | PARTIAL: no merged privilege-mutation/session-rotation API or private review resources |
| C084 | Actual Chromium offline/online and remote logout; existing cookie configuration assertions | PARTIAL: deployed HTTPS/proxy not exercised |
| C085 | Real C034 -> MinIO expiry, foreign owner/assignment denial and C051 playback/delete races | DONE for implemented media; not full C054 edit/submit acceptance |
| C086 | Ordinary-runtime staff denial, session-specific proof isolation, post-lookup demotion and post-sign commit rollback | PARTIAL: real MFA/eligibility integration and independent QA remain BLOCKED |
| C087 | Confirmed provider-exception privacy defect reproduced and sanitized in C034 | DONE for this finding; whole-feature/release acceptance remains BLOCKED |

## C083 identity and session boundary

security-identity.integration-spec.ts uses actual Nest controllers, real Argon2
login and server session guards, with synthetic users in a disposable PostgreSQL
schema. Default policy/MFA/evidence providers remain closed. Missing, altered,
expired/revoked sessions and suspended/deleted/unverified account states fail
across auth/profile/preferences/questionnaire/consent/video/block reads. Account
status fixtures are not an implemented account-deletion/provisioning workflow.

Login ignores attacker-selected cookies and another account's session. Logout-all
and actual Mailpit password reset invalidate both target sessions across feature
boundaries while preserving an unrelated user's session. Role demotion is read
from PostgreSQL despite stale cookie/request claims. This does not prove automatic
rotation on privilege elevation: that mutation contract is absent.

Forged owner fields/queries cannot alter another profile/consent/video or remove
another account's block. Media confirm/playback without consent deny at the
existing 403 consent precheck; foreign delete is 404. Positive-consent media
ownership is checked separately in C085. No nonexistent review route is used as
proof of authorization.

## C084 browser transport and cookie boundary

security-regression.auth-e2e.ts uses real registration, Mailpit activation, login,
Next proxy and Chromium network-offline mode on desktop/mobile. Offline session
revalidation hides private content without redirecting or removing the cookie.
Online recovery restores the original session; an independent browser's real
logout-all while offline instead yields 401 and the normal login redirect.

The browser verifies HttpOnly, host-only, Path=/ and local HTTP SameSite=Lax /
Secure=false without reflecting token values. Existing session-cookie.spec.ts
checks Secure/HttpOnly/SameSite/host-prefix-compatible options for production
configuration. Existing auth-security/proxy/redirect tests cover 401/403/500,
request aborts and unsafe next paths. Those checks are retained, not duplicated.
Actual deployed HTTPS cookie acceptance and reverse-proxy topology are NOT RUN;
configuration assertions are not an HTTPS deployment smoke test.

## C085 native media boundary

security-media.integration-spec.ts drives actual login, C032 qualification approval,
Consent API, upload/confirm, C033 assignment, C034 signing and C051 cancellation.
Only policy/qualification/MFA fixture sources are synthetic, explicitly testOnly
and bound to fixture identities/sessions. No success authentication/assignment
handler is substituted and production access stays closed.

Native MinIO rejects unsigned GET/HEAD and altered signature TTL, serves a signed
range with private/no-store, and rejects the real issued C034 URL after the bound
assignment expiry. Existing owner 60-second provider expiry tests are retained.
Positive-consent foreign owners and correctly session-bound unassigned experts
still cannot obtain URLs. Review re-consent leaves old bindings cancelled; only
an explicit new C033 assignment authorizes a new URL.

Both real User-lock orderings of playback versus owner DELETE are observed through
pg_blocking_pids. A playback authorized first may return a short-lived bearer URL;
a delete committed first returns no URL or successful playback audit. Cancellation
advances once with one retained context. Existing bearers can work until provider
removal/expiry; MinIO HEAD verifies final-object removal after cleanup. The cleanup
task correctly stays PENDING while the incoming PUT URL is still live. This is not
full erasure, backup invalidation or full C054 review edit/submit race completion.

## C086 staff and commit boundary

security-staff.integration-spec.ts proves ordinary development/production modes
refuse expert/member/moderator/admin access even when fixture providers supply
synthetic or real-looking proof flags. A role flag or a different session's proof
never grants access. This is negative release-gate coverage using synthetic data,
not evidence that real MFA was integrated or real-data staff access is safe to open.
Policy-less withdrawal/C051 restrictions still work while production access is closed.

Actual independent login sessions are bound separately; logging one out denies
that session while the other retains only its own explicit test assurance. A real
session lookup followed by a database role change is rechecked in C034, so a stale
server context cannot sign. A PostgreSQL deferred audit failure after actual
MinIO signing returns no prepared URL and rolls back the successful-read audit;
retry after removing the fault works. No review draft/QA self-approval test is
fabricated for absent APIs.

## C087 findings and disposition

T15-F01 (P2, ordinary production access still gated): C034 rethrew HttpException
from MFA/evidence/qualification-registry sources as if it were an application-owned
public error. Three actual HTTP/PostgreSQL/native-MinIO fault probes returned the
provider's synthetic private code/message/objectKey unchanged. This is a confirmed
boundary defect, not a claim that real production media leaked. No critical/high application-logic
finding was reproduced in the implemented paths examined; unavailable workflows
and the dependency audit findings below are not thereby certified.

The focused correction sanitizes only upstream source failures to existing 503
EXPERT_ACCESS_UNAVAILABLE. Application-owned 401/403, role/assignment/consent checks,
lock order, CAS, C033/C051 behavior and TTL remain unchanged. The original three
probes FAIL before the correction and PASS afterward; normal retry signs only
after valid authorization and writes its normal minimal audit. Default source
providers and release gates are unchanged. Phuc was notified before changing the
shared C034 boundary in the PR #18 coordination comment; his review of this T15
PR remains required. No unmerged C035/C036 code is copied or imported.

No fake fix/history is created for missing QA, Matching, real MFA, role provisioning
or account deletion. C087 fixes the concrete privacy finding found during this
regression pass; it is not a blanket claim that all planned authorization workflows
have been audited or that the application is production-ready.

## Execution and release boundary

Use existing disposable-schema integration helpers, native Mailpit/MinIO and real
browser contexts. No reset or migration of the developer public database, new
policy approval, production data access or secrets in version control is allowed.
Each test result is recorded in the PR at its actual tested head. Production
trusted MFA/qualification/policy sources, operator alert routing, retention and
complete review/QA/matching acceptance remain release blockers.

## Verification scope and known blockers

- New cases: 11 C083 PostgreSQL/Mailpit, 4 C084 real browser desktop/mobile, 5 C085 native media, 5 C086 staff/commit and 3 C087 provider privacy probes.
- Existing source tests are preserved, including the 60-second owner URL provider expiry, SMTP confirmation failures, consent/mutation rollback, block/report/moderation audits, C031-C034 lifecycle and C051 concurrent workers.
- PASS/FAIL counts for full unit/integration/browser/build validation and the exact CI head are recorded in the PR. Failed pre-fix privacy probes are evidence of reproduction, not passing security acceptance.
- BLOCKED: actual role-elevation/provisioning rotation, private review/edit/submit/independent QA/report/claims/matching/account-deletion APIs; Phuc PRs #18/#20 are not merged into this branch.
- NOT RUN: deployed HTTPS/proxy and actual trusted MFA/qualification/consent-policy publication, alert routing/outage delivery drill, production retention/backup/restore and full user journey. Production real-data staff access remains BLOCKED.

## Dependency audit — FAIL / production gate remains open

Read-only npm audit at this T15 pass reports 68 affected dependency-tree entries:
54 high, 11 moderate, 3 low, 0 critical. npm audit --omit=dev reports 16 entries:
11 high, 5 moderate, 0 critical. Both commands exit 1. These are npm rollups, not
counts of independent code defects or evidence of exploitation. Omission of dev
dependencies does not prove each remaining package/advisory is reachable at runtime.

The lockfile/manifests are byte-identical to the develop baseline; this feature
introduces no dependency or version change. The inherited advisories include
body-parser, multer, js-yaml/lodash, PostCSS and toolchain/transitive families.
Representative upstream records: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[multer](https://github.com/advisories/GHSA-5528-5vmv-3xc2),
[PostCSS](https://github.com/advisories/GHSA-6g55-p6wh-862q).
A complete application/deployment reachability assessment and patched supported
versions remain unresolved. No blanket non-exploitability waiver is claimed.

Many npm suggested fixes cross Nest/Next/Jest major versions, so this regression
PR does not run audit fix --force or perform an unreviewed shared-framework
migration. Huong/Phuc must review a separate dependency-remediation change, rerun
all gates and record remaining accepted risks before release. Audit is FAIL even
when scoped regression tests/CI pass; Feature 06 and production security are not
complete. The C087 provider-body correction is completed independently of this
unresolved dependency gate.
