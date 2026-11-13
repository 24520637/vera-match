# Protected route foundation

Place future member, expert, and moderator routes in this group. Parenthesized
route groups do not add URL segments. The layout supplies the shared container
and main-content target for the root skip link. Feature pages can compose
`PageHeader`, `WorkspaceLayout`, and other shared components inside it.

This group has no pages yet and does not enforce access control. Before adding
private content, integrate Huong's server-validated session and role checks.
API authorization must still enforce ownership, assignment, and consent rules.
Do not treat this folder or layout as a security boundary.

The public landing page and design-system preview remain at `/` and
`/design-system` in the sibling `(public)` group. Global styles, design tokens,
fonts, metadata, and the skip link remain in the root layout.
