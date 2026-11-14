# Protected route foundation

Place future member, expert, and moderator routes in this group. Parenthesized
route groups do not add URL segments. The layout supplies the shared container
and main-content target for the root skip link. Feature pages can compose
`PageHeader`, `WorkspaceLayout`, and other shared components inside it.

This group has no pages yet. Its `AuthLoadingBoundary` defaults to pending and
withholds child rendering. It performs no session requests, role checks,
redirects, or token storage. Before adding private content, integrate Huong's
server-validated session and role checks.
API authorization must still enforce ownership, assignment, and consent rules.
Do not treat this folder or layout as a security boundary.

## C010 authentication presentation handoff

`AuthLoadingBoundary` accepts `state` and an optional `onRetry` callback. Huong's
session integration must supply the validated state; do not introduce a second
auth provider or infer authentication from a cookie's presence. The current
layout intentionally stays pending until that integration is implemented.

| State | Presentation |
| --- | --- |
| `pending` (default) | Named loading status and busy region; children withheld |
| `authenticated` | Render children |
| `unauthenticated` | Sign-in-required notice; children withheld |
| `forbidden` | Permission notice; children withheld |
| `error` | Recovery notice and optional retry action; children withheld |

The session owner maps actual `401` responses to unauthenticated and `403` to
forbidden. Network/`5xx`/invalid-response failures need recovery feedback rather
than logout. Cancellation must not become unauthenticated. A retry handler
should enter pending synchronously before starting another session check and
ignore stale or cancelled results. The boundary owns no request lifecycle.

This UI boundary cannot prevent server components passed as children from
executing or their data from being serialized into React Server Component
payloads. Server-side authorization must precede fetching or passing private
data, and API authorization must independently enforce access. C010 does not
complete authentication or authorize any real member data.

Regression tests use a separate Next.js fixture under
`apps/web/tests/fixtures/auth-loading`, served only by Playwright on port 3101.
It exercises synthetic presentation states without auth endpoints or private
data. The fixture is not part of the product's App Router routes.

The public landing page and design-system preview remain at `/` and
`/design-system` in the sibling `(public)` group. Global styles, design tokens,
fonts, metadata, and the skip link remain in the root layout.
