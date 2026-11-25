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
