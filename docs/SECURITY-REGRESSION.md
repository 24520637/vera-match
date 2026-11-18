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
| C085 | Pending real media boundary checks | NOT RUN |
| C086 | Pending staff fail-closed checks | NOT RUN: real MFA/QA unavailable |
| C087 | Findings disposition after the matrix | NOT RUN; never invent a fix commit |

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

## Execution and release boundary

Use existing disposable-schema integration helpers, native Mailpit/MinIO and real
browser contexts. No reset or migration of the developer public database, new
policy approval, production data access or secrets in version control is allowed.
Each test result is recorded in the PR at its actual tested head. Production
trusted MFA/qualification/policy sources, operator alert routing, retention and
complete review/QA/matching acceptance remain release blockers.
