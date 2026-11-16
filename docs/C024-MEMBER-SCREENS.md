# C024 member settings

Routes `/account/profile`, `/account/questionnaire`, `/account/preferences` and
`/account/consents` reuse the existing protected layout, AuthProvider, session
validation, same-origin `/api` transport and design components. They introduce
no authentication endpoints or alternate session storage. Staff do not receive
access through these own-member screens.

Profile/preferences PATCH sends only explicitly edited fields. Blank nullable
inputs clear with null; catalog controls distinguish unset from an empty list.
Priority order is preserved without new weights or matching algorithms.
Questionnaire PUT sends exactly the three approved version-1 answers. The UI
does not reinterpret a future/unknown catalog as version 1.

Resource revisions remain separate. A 409 preserves the draft, requires an
explicit read of current data and a review checkbox before a new submission.
Legacy 503 revisions are safely retained by the existing ApiError transport;
the user must explicitly correct affected fields, without default-filled writes.
Unknown validation paths appear in the visible, focusable summary. There is no
automatic retry or autosave. Drafts remain in memory, not browser storage.

## Consent policy and recovery boundary

No policy is published by the runtime registry. Product routes pass no policy
content/IDs to the consent component, so grant buttons are unavailable. They do
not reuse an old accepted policy, PENDING_POLICY_VERSION or synthetic policy.
An approved policy publication integration is future coordinated work.
The grant flow is tested with explicit policy agreement only in an isolated
presentation fixture using synthetic notices. The API remains authoritative.

Withdrawal remains independent of the other forms and of the grant quota.
Each explicit consent action gets a random idempotency key. After uncertainty,
no success is inferred; only explicit user-requested reconciliation can reuse
the original payload/key. Reconciliation may apply the original operation if
it was never committed. Successful responses are followed by a current read:
historical idempotent replay is never displayed as present consent state.
Conflict recovery requires refreshing and choosing the action again; grants
require renewed explicit agreement. Rate-limit expiry never resubmits an action.

These screens do not implement cleanup workers or media/matching consumers.
Production retention, storage/backup policy and signed-URL provider enforcement
remain open as described in C012 and C023. Withdrawal does not promise immediate
invalidation of previously issued URLs or physical erasure.

## Verification commands

```powershell
npm.cmd run lint --workspace apps/web
npm.cmd run test:ui --workspace apps/web -- tests/member-contracts.spec.ts tests/member-settings.spec.ts tests/api-client.spec.ts tests/api-retry-after.spec.ts --workers=1
```

The presentation tests use the existing isolated fixture app and mock HTTP
responses for loading, validation, revisions, 401/403/429/503, grant agreement and
uncertain-result reconciliation. They are not database persistence evidence.

For real browser -> Next proxy -> API -> PostgreSQL verification, provide a
verified local disposable PostgreSQL 18 test database on loopback port 5433,
set DATABASE_URL and synthetic MinIO config, then run:

```powershell
node scripts/run-member-e2e.cjs
```

The runner builds API/web and reuses the existing disposable Auth test server and
teardown. Tests seed synthetic verified members and real HttpOnly sessions only
in the run-ID-validated UUID schema. No SMTP/MinIO requests are made. Desktop and
mobile cover persistence/refresh, revision conflicts, all five withdrawals,
database events/tasks, settings-region accessibility and no local/session storage. Legacy grant
fixtures exercise withdrawal without inventing a production policy. Real grants
remain unavailable until policy publication is approved; the live test does not
claim otherwise. Runtime schema/metadata cleanup is mandatory.

On restricted Windows environments, Playwright may need process permissions to
terminate its own Next servers during teardown. Do not stop unrelated services.
Test results must be reported from actual execution, not inferred from these commands.

PR #10 regression coverage also exercises the real client session boundary:
temporary session network/503 failures hide private controls while preserving
unsaved resource drafts in a member-scoped memory provider outside that boundary.
The same member must review refreshed saved data before submitting restored edits.
Confirmed logout, forbidden access, account changes and leaving the member layout
invalidate that memory. Drafts are not written to browser storage and do not survive
a full reload. Consent reconciliation retains the original unresolved payload and
idempotency key across HTTP 429; countdown expiry only enables manual retry.
CI runs the real member desktop/mobile runner after installing Chromium and starting
the existing PostgreSQL service, retaining its HTML report under the UI artifact.

Full-page axe inspection also reports a pre-existing shared header wordmark
`label-content-name-mismatch` in `components/layout/site-header.tsx` (visible
VERAMatch versus aria-label VERA Match home). C024 does not change that shared
component; live settings accessibility assertions are scoped to `.member-settings`.
This is not a claim that full-page accessibility has passed without exceptions.
