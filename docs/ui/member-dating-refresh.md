# Member dating interface refresh

Frontend-only change. API endpoints, payloads, validators, consent/MFA rules, database and matching policy are unchanged.

## Journey

- Default member sign-in destination: `/account/matches`. Staff retain `/account`; explicit supported destinations remain respected.
- Discover uses introduction cards with existing recommendation reasons, interested/pass actions and a reminder that decisions are final.
- Connections shows only mutual entries from the current history page. Pagination still comes from decision history: an empty page does not mean no mutual connection exists on older pages.
- All activity preserves accepted/declined history and unavailable states. Connections & chat links open the connection view via a hash anchor.
- Opening a mutual connection provides profile/sharing/conversation anchors. Peer information is rendered only from the authorized connection response. Profile/contact/chat remain off unless explicitly saved; chat requires both members.
- Supporting preferences, consent, videos, reviews, safety and closure remain reachable under “Preferences, privacy & more”. Staff tools are unchanged.

## Why this supports dating

Discovery and mutual interest become the main tasks instead of account administration. Cards emphasize existing common-ground reasons without fabricating names, photos or compatibility scores. The three-step explanation sets expectations about mutual acceptance and sharing. Connection activity is separate from passes and pending interests. Conversation bubbles distinguish who spoke; mobile cards/actions and wrapping keep controls usable on narrow screens. Privacy controls remain close to the conversation so disclosure is deliberate.

This is a usability-oriented redesign, not evidence of improved match outcomes or conversion. Recommendations are still anonymous before mutual acceptance; peer profile/photo/contact must still be explicitly shared. There is no new global messages API or invented message inbox.

## Verification

TypeScript lint; browser regression coverage for discovery pagination, malformed responses, exact decision receipts, member/staff navigation, lost sessions, opt-in sharing, message send and stale content removal on denied refresh. Desktop and 390px mobile views use synthetic intercepted API responses, not real member data. Post-login destinations tested separately.

Result: 36 navigation/matching/connection/session checks and 4 post-login checks passed across desktop and mobile (40 total). TypeScript lint passed. Chromium was supplied by the environment; the unavailable Playwright download was replaced with the installed browser for this verification.

## Second pass: less scrolling, clearer connection states

- Discovery is now the initial view; history stays under All activity. How-to guidance is expandable. Connection counts explicitly refer to the current history page, not a fabricated global total.
- The introduction banner is shorter, with compact cards and a small decorative placeholder instead of a large image area. No pre-mutual identity or photos are invented.
- The connection workspace uses a two-column desktop layout: profile/sharing on the left and conversation on the right. Mobile follows profile → conversation → sharing. Hero typography and spacing are bounded locally instead of inheriting the large public landing-page header.
- Chat status distinguishes permission needed, waiting for the peer, and both enabled. A link leads directly to sharing controls. The composer has a length indicator and explicit retry guidance.
- Errors distinguish timeout, network failure, HTTP 5xx, forbidden access and invalid responses. This improves diagnosis, but does not claim to resolve an unobserved deployment/API failure. Failed/denied reads still clear protected content. A failed send retains the original message UUID and exact text for a retry after access is rechecked.

Second-pass validation: TypeScript passed. 32 existing/updated browser checks passed on desktop/mobile; the 2 new delivery-retry checks passed after scoping their alert locator to main (Next.js also renders a route-announcer alert). Total: 34 checks. Synthetic previews: [Discover desktop](member-dating-v2/discover-desktop.png), [Discover mobile](member-dating-v2/discover-mobile.png), [Connection desktop](member-dating-v2/connection-desktop.png), [Connection mobile](member-dating-v2/connection-mobile.png). These screenshots use intercepted fixture responses, not real member records or live-host verification.
