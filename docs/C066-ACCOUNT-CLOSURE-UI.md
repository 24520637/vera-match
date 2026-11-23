# C066 — Account closure and restricted status UI

Status: **IMPLEMENTED AND VERIFIED — C065 foundation UI; final lifecycle PARTIAL**. Stacked on [PR #35](https://github.com/24520637/vera-match/pull/35), backend commit 3b03632; no backend, policy publication or retention change here. Owner decisions are [PR #34](https://github.com/24520637/vera-match/pull/34).

## Design direction and review

Use the shared considered-conversation direction: canvas #F5F3F8, paper #FFFFFF, ink #35263B, plum #513957, existing warning/error semantic tokens. Newsreader carries the page heading; Instrument Sans carries controls and explanatory text. No new tokens, fonts, theme, dependency or primitive. One bounded, left-aligned form explains consequences before fresh password/typed confirmation; the existing Modal provides the final keyboard-accessible decision. The public status route reuses AuthScaffold's focused panel. Existing spacing/radii/focus indicators remain authoritative in UI-DESIGN-SYSTEM.md.

Layout: member navigation → editorial heading → access/cleanup explanation → password → exact phrase → final confirmation dialog. Mobile wraps the shared navigation and dialog actions; no fixed overlay obscures controls. Screenshot review at 1440px and 390px confirmed readable wrapping and no horizontal overflow. No repeated card grid or decorative motion.

Reviewed with frontend-design and current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Shared labels, error summary, keyboard focus/escape/return, loading feedback, paste and password-manager support are retained. The exact confirmation phrase is protected from automatic translation. No new unresolved UI finding remains in the implemented scope. Native mobile keyboards and every browser/OS combination are NOT RUN.

## Behavior

- /account/closure requires the existing member session/role boundary and checks the real availability API before collecting any password. Production reports unavailable; the page explains release review and requests no password.
- Current password and exact CLOSE MY ACCOUNT are required; a shared confirmation dialog has a safe cancel action. Cancel/visibility changes clear sensitive controls. No password or confirmation is persisted in browser storage.
- Successful acceptance clears the form and existing AuthProvider user, broadcasts the session change and performs a full navigation to /closure-status to discard member state. Other tabs lose access; no privileged session survives for progress.
- An unknown/5xx/lost acknowledgement disables irreversible resubmission and directs the owner to restricted status. No retry on timers, countdown or connectivity. Known validation, permission and staff-deprovisioning errors remain distinct.
- 429 uses the existing C009 ApiError/Retry-After hook and requires an explicit later action. The browser fixture exercises UI throttling; the real API 429/header proof lives in C065 PostgreSQL integration.
- /closure-status reads and immediately removes a token fragment on initial load or same-document hashchange. It never consumes automatically: a button explicitly exchanges the one-time capability. No token in local/session storage, no ordinary login, no public identity/status lookup.
- Verified status accurately says access remains closed while cleanup/retention remain pending. Generic email requests do not disclose eligibility. Unknown outcomes require another email; no final-erasure claim.

## Executed acceptance

PASS: 10 desktop/mobile Member E2E, including six new closure scenarios, actual Nest API/SQL/session guards and Mailpit; native rollback/reauth/expiry/quotas are covered in C065. Browser acceptance verifies wrong password, keyboard cancellation/focus, manual retry after 429, a real 202 with cookie clearing, another tab's draft removal, real emailed status consumption/replay rejection, and a real accepted commit followed by intentionally lost HTTP acknowledgement. The release-unavailable browser case is an explicit UI response fixture; actual production gate behavior is tested by C065. No success-mocking auth handler.

PASS: existing 214 shared UI/accessibility checks, scoped Axe on member and status pages, API/web production builds and TypeScript/lint. Initial same-tab emailed fragment failed acceptance; hashchange handling fixed it and subsequent browser runs passed. No backend contract or AuthProvider/API-client implementation changed.

CI uploads screenshots as account-closure-ui immediately after Member E2E; later suites cannot overwrite that visual evidence. Browser traces for the status flow are disabled to avoid recording bearer fragments. Screenshot contents contain no private profile or report data.

Remaining: approved production release/policies/retention, domain minimization/receipts, independent recovery journal/fence and support recovery. This UI cannot make the backend lifecycle or final erasure complete. No automatic merge.
