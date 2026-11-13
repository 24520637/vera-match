# VERA Match UI design system

**Implementation: DONE. Design approval: PENDING Huong’s review.** Shared presentation components and interactive examples; authentication, persistence, consent enforcement, matching and review services remain planned. This PR must remain open until Huong approves the shared components and direction.

## Direction: a considered conversation

VERA Match is an adult matchmaking product where people explain themselves, choose what to share and receive contextual human review. The interface should feel attentive and personal while making permissions unmistakable. Premium describes the care in typography, spacing and interaction; it does not imply a paid tier.

The visual anchor is a large editorial question, paired with a spacious, left-aligned headline. Mist/lilac surfaces, plum actions and a sage conversation panel distinguish the product from swipe interfaces and clinical assessment tools. The two halves of the small conversation motif represent a mutual connection. It is decorative, not a trust mark.

Initial alternatives considered: a warm cream/clay palette, a dense newspaper layout, and an equal-card dashboard. These were rejected as generic or ill-suited to sensitive, individual stories. The chosen layout uses generous reading space, sequential rows only where there is a real sequence, and contained cards only for focused tasks. No gradients, glass effects, people scores, decorative statistics or animated reveals.

```text
Wide public page                 Narrow public page
Brand              Navigation   Brand          Menu
Headline        Question panel  Headline
Description                     Description + action
Action                          Question panel
Approach        Sequential rows Approach + steps
Privacy statement               Privacy statement

Wide workspace                  Narrow workspace
Section navigation | Main task  Section navigation
                   | Context    Main task
                                Supporting context
```

## Foundation tokens

`apps/web/src/app/tokens.css` is the source of truth. Use semantic tokens, not copied hex values, in shared components. Route-specific art direction can use their own scoped classes.

| Role                        | Token                                       | Value                 |
| --------------------------- | ------------------------------------------- | --------------------- |
| Page ground                 | `--color-canvas`                            | `#F5F3F8`             |
| Focused surface             | `--color-paper`                             | `#FFFFFF`             |
| Primary text                | `--color-ink`                               | `#35263B`             |
| Supporting text             | `--color-muted`                             | `#66596C`             |
| Action / brand              | `--color-plum`                              | `#513957`             |
| Stronger action hover       | `--color-plum-hover`                        | `#38233E`             |
| Supporting lilac surface    | `--color-lilac`                             | `#E9E0EE`             |
| Conversation surface / text | `--color-sage` / `--color-forest`           | `#DCE8E0` / `#34564B` |
| Decorative divider          | `--color-line`                              | `#D7CDDA`             |
| Control boundary            | `--color-control-border`                    | `#96869D`             |
| Keyboard focus              | `--color-focus`                             | `#804193`             |
| Success text / surface      | `--color-success` / `--color-success-bg`    | `#245840` / `#EAF3EC` |
| Error text / surface        | `--color-error` / `--color-error-bg`        | `#982E42` / `#FFF0F2` |
| Warning text / surface      | `--color-warning` / `--color-warning-bg`    | `#795411` / `#FAF1DB` |
| Disabled surface / text     | `--color-disabled` / `--color-disabled-ink` | `#E1DBE4` / `#685D6E` |

Decorative dividers do not identify controls: controls use the darker boundary token. Use white text on plum; forest text on sage; ink or muted text on the page/paper. Do not assume arbitrary token combinations are accessible. Focus on plum uses a white outline. Status includes a textual explanation, never color alone.

- **Type:** self-hosted Newsreader regular for editorial headings; Instrument Sans regular/semibold for UI and body. Local assets and OFL licenses are in `apps/web/src/app/fonts`. `next/font/local` preloads and uses `display: swap`; builds and page loads do not contact a font provider. Sources: [Google Fonts Newsreader](https://github.com/google/fonts/tree/main/ofl/newsreader), [Instrument Sans](https://github.com/google/fonts/tree/main/ofl/instrumentsans).
- **Scale:** small 14px, body 16px, lead 18px, section heading 32–44px, page title 40–64px, public display 52–88px; fluid sizes use `clamp`. Body line-height 1.6; heading line-height 1.06 (display .98). Body measure ≤65ch; lead ≤55ch. The initial 100px headline produced a stranded first word on desktop; visual review reduced it to 88px and widened its measure. No all-caps interface labels, invented letter spacing or isolated headline-word coloring.
- **Spacing:** `--space-1` through `--space-9` = 4, 8, 12, 16, 24, 32, 48, 64, 96px at the default root size. Use the 4px base for controls and a larger rhythm between editorial sections.
- **Geometry:** 1px borders; 8px control radius, 16px card radius, 24px dialog radius, fully rounded status badges. The asymmetric conversation/profile illustration shape is a brand motif, not a default card shape.
- **Elevation:** only modal overlays use a shadow. Normal content uses spacing, surface and alignment.
- **Motion:** no autoplay animation. Hover colors respond in 140ms; pressed buttons move 1px. Reduced motion removes transitions and movement. Progress uses a static ring plus an explicit loading label; no continuous spinner or shimmer.
- **Theme:** light-only in this proposal, with explicit `color-scheme` and matching browser theme color. Forced-colors mode preserves boundaries and disabled states. Dark mode needs its own contrast review before introduction.

## Shared component contract

Components live under `apps/web/src/components/ui`. Native props and React 19 refs pass through. Do not fork a component for a feature; add a documented variant only when the interaction genuinely differs.

| Component                         | Contract and use                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                          | `variant`: primary, secondary, quiet, danger; `size`: regular/small; defaults to `type="button"`. Explicit `type="submit"` in forms. `loading` sets disabled + `aria-busy`, with `loadingLabel`. Keep submit enabled until an actual request begins.                                                                                            |
| `ButtonLink`                      | Same appearance, rendered as Next `Link` for navigation; preserves modifier-click/new-tab behavior. No disabled navigation variant.                                                                                                                                                                                                             |
| `Input`, `Select`, `Textarea`     | Required `name` and visible `label`; optional `hint` and `error`; generated or caller-supplied unique ID. Error adds `aria-invalid` and a linked description. Native keyboard, input type, autocomplete and selection semantics are preserved.                                                                                                  |
| `Checkbox`                        | One generous label/control hit target. Supports independent consent choices; default unchecked. Optional linked hint/error. Never use one checkbox to bundle permissions.                                                                                                                                                                       |
| `Form`, `Fieldset`, `FormActions` | Native form, grouped fields with a legend, and wrapping action row. Application owns submit behavior and request state.                                                                                                                                                                                                                         |
| `ErrorSummary`, `focusFirstError` | Summary links to caller-provided field IDs. After setting field errors, focus the first invalid control. Keep input values on validation/request failure.                                                                                                                                                                                       |
| `Card`                            | `tone`: paper, sage or plum. A neutral container for one task; caller supplies semantic headings. No default shadow, click handler or fixed height.                                                                                                                                                                                             |
| `Modal`                           | Controlled `open` / `onOpenChange`; required title; optional description and initial focus ref. Native `<dialog>` makes the background inert; an explicit Tab/Shift+Tab boundary handler keeps keyboard focus inside. Escape/Close dismiss; closing restores the trigger and scrolling. Destructive confirmation focuses the safe action. Backdrop clicks do not discard work. Avoid nested dialogs. |
| `Notice`                          | Info, success, error, warning. Error uses `role="alert"`; other feedback uses `role="status"`. Dynamic field errors use polite announcements. Success follows server confirmation in connected flows.                                                                                                                                           |
| `Badge`                           | Neutral/success/warning workflow labels. Does not imply identity verification, expert qualification or verified character.                                                                                                                                                                                                                      |
| `LoadingState`, `EmptyState`      | Named progress and a stable skeleton; or a clear explanation plus a relevant next action. Empty content is not an error.                                                                                                                                                                                                                        |

```tsx
<Input
  id="member-email"
  name="email"
  label="Email address"
  type="email"
  autoComplete="email"
  spellCheck={false}
  required
  error={errors.email}
/>
<Button type="submit" loading={pending} loadingLabel="Saving…">
  Save changes
</Button>
```

`Form` preserves browser validation by default. Use `noValidate` only when the feature supplies explicit validation, inline errors and error focus, as the examples do. Client validation supplements server validation. Never block paste; use `current-password` or `new-password` as appropriate in real authentication forms.

## Layout and navigation

`SiteHeader`, `PageHeader`, `Section` and `WorkspaceLayout` provide the shared structure. App Router pages remain server components; only interaction islands and the mobile header are client components. No UI framework, state library or icon dependency is introduced.

- Container max-width 76rem; safe-area-aware gutters; text remains left aligned.
- At ≤48rem, navigation becomes an in-flow button-controlled disclosure. Hidden links leave the tab order. Escape returns focus to Menu. It does not overlay or obscure page content.
- Section navigation uses real hash links for deep links, history and keyboard access. Content IDs have scroll margins.
- Sidebar/content stacks on narrow screens. Forms cap around 30rem; media/evidence sit side by side only when space permits. Buttons/actions wrap; long input and user content must wrap without horizontal page overflow.
- Skip-to-content is the first keyboard target. Focus is a 3px offset outline. Regular actions and inputs are at least 48px high; compact controls/navigation at least 44px.
- No fixed footer or sticky header covers focused controls. Zoom is unrestricted. The native modal scrolls within the viewport with contained overscroll.
- `useUnsavedChanges` handles browser exits and ordinary link navigation for the profile example. It preserves same-page section navigation. It is not a universal App Router navigation interceptor: feature teams must cover programmatic navigation/history changes when introducing them.

## Product patterns and state rules

### Authentication

Use a narrow focused form, persistent labels, password-manager autocomplete and inline validation. During session restoration, withhold protected content. A server `401` means invalid/expired authentication; `403` means insufficient access. Offline/`5xx` keeps edits and offers retry, without implying logout. Do not store tokens in browser storage. The example only validates fields and explicitly says no sign-in was attempted.

### Profile and preferences

Group identity, intentions and permissions with fieldsets. Show optional fields and limits before input. Permissions start off and are saved/revoked independently. The pattern shows two representative controls, not the complete five-purpose consent implementation. The profile preview is page-local; success text does not claim persistence. Reset requires confirmation when edits exist.

### Matching

Use a readable profile-and-context row with a short member quotation and explicit reason source. The specimen is fictional and uses a monogram instead of a stock person implying a real member. No invented counts, compatibility percentage or relationship predictions. In the connected flow, show accept/decline only for authorized recommendations; disclose a mutual connection only after both decisions are persisted. Blocking and consent withdrawal must invalidate recommendations on the server.

### Expert review

Keep the private player and timestamped evidence editor adjacent on wide screens and stack them on mobile. Without confirmed assignment and current consent, show the access state and disable editing; never load a placeholder private URL. A real player must provide native keyboard controls, captions/transcript when applicable, and signed-URL expiry/retry handling.

Record observation category, source time range, context and limitations. Distinguish draft, submitted, returned and QA-approved states. QA cannot approve its own assessment. Handle stale versions (`409`) without discarding drafts. Member-facing claims need separate confirmation/share/revoke controls. Only QA-approved, owner-confirmed, share-approved, unrevoked facts covered by current consent can reach matching. No subjective character inference.

| State                    | Required behavior                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Initial loading          | Stable placeholder and named progress; no flash of private data.                             |
| Submitting               | Disable the triggering submit action, keep the label meaningful, prevent duplicate requests. |
| Empty                    | Explain absence and offer the next valid action.                                             |
| Validation error         | Retain values, link summary and inline errors, focus first invalid field.                    |
| Network/server failure   | Preserve edits, explain recovery, offer retry in the connected feature.                      |
| Session expired / denied | Distinct copy and next action; backend remains the authority.                                |
| Conflict                 | Retain local draft and compare/reload the current version before retry.                      |
| Success                  | Announce confirmed outcome; avoid unconfirmed persistence claims.                            |
| Disabled                 | Explain the prerequisite nearby and with `aria-describedby` where needed.                    |
| Revoked consent/access   | Remove sensitive content, stop playback, explain why the task is unavailable.                |

The `/design-system` gallery is public, marked `noindex`, and holds no actual member data or authenticated UI. It has no API calls, uploads, cookie/token logic, localStorage or sessionStorage writes. Demo dialog/form state is ephemeral, so it does not belong in the URL. Product navigation/filters should be URL-addressable when implemented.

## Verification and audit

Commands: `npm run lint --workspace apps/web`, `npm run build`, `npm test`, `npm run test:ui --workspace apps/web`. Install the test browser with `npx playwright install chromium` (CI uses `--with-deps`). UI tests run Chromium at desktop and touch-mobile viewports; production CI runs against the built Next app. Playwright and axe are dev-only dependencies.

Coverage: skip link/mobile keyboard navigation; first-error focus and linked descriptions; no credential request/storage; independent consent defaults; reset confirmation, focus containment/Escape/return; dirty-navigation guard; no private media without assignment; disabled/busy actions; 320px wrapping; reduced motion; automated WCAG checks on both pages and the open modal.

Web audit source: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), fetched for this review. Sentence case is an intentional brand decision from the frontend-design brief, taking precedence over the source’s title-case preference. Native controls supply keyboard behavior; no custom key handlers replace their semantics. No global suppression of native page overscroll is applied.

Results for this branch:

| Verification | Result |
| --- | --- |
| Frontend TypeScript check | PASS |
| Root build (NestJS + Next.js); final Next production build | PASS |
| Existing API Jest suite | PASS — 1 test |
| Playwright UI suite against production build | PASS — 16 tests, desktop and touch-mobile Chromium |
| axe WCAG-tagged scans, both routes and open modal | PASS — no automated violations |
| Responsive overflow checks at 320, 390, 768 and 1440px | PASS |
| Keyboard / dialog / validation / reduced motion | PASS |
| Visual inspection of desktop/mobile pages, controls and dialog | PASS — screenshots linked below |
| Git diff whitespace and local Markdown links | PASS |
| npm audit (repository dependency tree) | FAIL — 38 entries: 11 low, 12 moderate, 15 high; existing package versions unchanged by this PR |
| Manual screen-reader, Safari and Firefox checks | NOT RUN |
| Real authentication, DB persistence, private video and matching E2E | NOT RUN — those features remain unimplemented |

Observed contrast ratios: ink/canvas 12.78:1; muted/canvas 5.94:1; white/plum 10.13:1; forest/sage 6.46:1; control border/paper 3.39:1; focus/canvas 6.16:1. Token combinations outside this set require their own check.

### Web Interface Guidelines audit

No unresolved findings in the implemented preview, with the documented sentence-case and native-overscroll decisions above. Review covered all changed files under `apps/web/src`.

- `apps/web/src/components/ui/modal.tsx:53` — PASS; repaired Tab escape, verified forward/reverse wrapping and return focus.
- `apps/web/src/components/ui/form.tsx:1` — PASS; labels, descriptions, validation and native input semantics.
- `apps/web/src/components/ui/button.tsx:1` — PASS; button/link semantics, disabled and pending states.
- `apps/web/src/components/ui/card.tsx:1`, `apps/web/src/components/ui/status.tsx:1` — PASS; contextual surfaces and named feedback.
- `apps/web/src/components/layout/site-header.tsx:1` — PASS; mobile disclosure, Escape and current-page semantics.
- `apps/web/src/app/layout.tsx:1`, `apps/web/src/app/globals.css:1` — PASS; skip link, local fonts, focus, wrapping and reduced motion.
- `apps/web/src/app/page.tsx:1`, `apps/web/src/app/design-system/page.tsx:1` — PASS; headings, honest preview copy and semantic navigation.
- `apps/web/src/components/patterns/` — PASS; validation, safe consent defaults, page-local examples and no unauthorized media loading.

### Visual review evidence

[Desktop home](ui-preview/home-desktop.png) · [Mobile home](ui-preview/home-mobile.png) · [Shared controls](ui-preview/components-desktop.png) · [Sharing dialog](ui-preview/sharing-dialog.png)

Screenshots were captured from the production build with local fonts loaded. After visual critique, the headline measure was widened and its maximum size reduced to avoid a stranded first word. Stretched spacing within content stacks was also removed.

Automated checks do not replace assistive-technology or cross-browser review. Dependency remediation is a separate task; no existing dependency versions were changed, and no runtime dependency was added.

## Decisions for Huong’s review

1. Approve mist/plum/sage and Newsreader/Instrument Sans as the shared brand direction, including the asymmetric conversation motif.
2. Approve component APIs, field/error behavior, status vocabulary and native dialog dismissal behavior.
3. Confirm the public, noindex `/design-system` preview location; decide whether to restrict it before a production release.
4. Coordinate with Phuc on adoption in profile/matching/review screens. Shared visuals do not change backend or feature ownership.
5. Confirm future Vietnamese localization, dark theme and actual media/caption requirements in their own implementation tasks. Current copy is English; existing locale has not been changed.

Do not merge this PR until Huong reviews the visual direction and components.
