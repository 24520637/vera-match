# T14 reciprocal matching and decisions

Phuc owns C078–C082. The original feature matrix is in
`a95a26c:docs/COMMIT-PLAN.csv`. The [approved profile and consent
contract](PROFILE-CONSENT-CONTRACT.md) governs the inputs. T08/T10/T12 remain the
source of private review evidence and permissions.

## C078 and C079 eligibility and ranking

Require two distinct active, verified, adult-declared MEMBER accounts with
visibility enabled, current evidence-backed `PROFILE_MATCHING` consent,
and valid UTC birth dates yielding ages 18–120. Apply both members’ age
bounds and explicit dealbreakers. A configured desired relationship goal is
a ranking input. The explicit `different-relationship-goal` dealbreaker
requires equal, known profile goals. Invalid matching inputs fail closed.
Check blocks in both directions.

Discovery inspects at most 48 shortlisted candidates per request and fetches
one extra shortlist ID to detect another window. It locks the inspected
candidates in sorted User ID order, rechecks the session and live rows, and
returns up to 16 eligible recommendations. If another eligible candidate is
found within the window after the page fills, continuation starts after the
last included candidate in shortlist order. Otherwise, if the lookahead
exists, continuation starts after the last inspected ID. An empty page can
carry a cursor. The cursor reveals no screened account IDs, exact counts, or
rejection reasons. Each page rechecks live eligibility. A fresh traversal can
revisit IDs already passed by a cursor.

Ranking is local to the discovered window. There is no global top-N.
Each direction uses that member’s lexicographic priorities:
known exact desired-goal match, Jaccard overlap for values and interests,
and an opaque tie key. Null priorities use the approved default order and
an empty list skips the optional criteria. Each member sees their own
direction’s ordering. The API exposes neither vector nor a combined score.

Ranking discloses no birth date, account or contact ID, private preference
target, free-text profile field, questionnaire response, or subjective
review assessment. The explanation confirms reciprocal eligibility.
Member identity and field-specific profile explanations require a documented
sharing policy. A global reciprocal aggregate and any structured lifestyle
criterion are also unresolved.

## C080 live claims

T14 calls `readMatchingClaimsInTransaction` under the same participant
locks. T12 requires matching version and independent QA, individual owner
confirmation and share approval, current consent and original source and
share generations, a speech observation on that review with the recorded
timecodes, no individual revocation, and no applicable open,
in-review, or upheld dispute. The only optional output is a distinct
canonical factual statement authorized for this viewer. Claims contribute
zero to ranking in the MVP. Claim-to-score mapping and contribution require
a product decision. The feature exposes
no reports, transcripts, observation or claim IDs, timecodes, source
details, feedback, or media locators. See [T12](EXPERT-REVIEW-WORKFLOW.md#7-t12-claims-and-disputes).

## C081 and C082 member API

All paths below are relative to `/api`. All require a cookie-authenticated
MEMBER. Responses are private and `no-store`, with `Vary: Cookie` and
`Referrer-Policy: no-referrer`. Browser mutation requests require the
configured Origin and JSON. In one minute, the process-local limits are
60 reads and 30 decisions per member, plus 300 requests per socket IP.
Throttling returns `Retry-After`.

| Request | Successful response |
| --- | --- |
| `GET /matches/recommendations?after=` | `{ available, recommendations: [{ key, pairId, reasons }], nextCursor }`. Omit `after` for the first window. `available: false` means the caller cannot participate right now. The GET creates no pair or decision. |
| `POST /matches/:pairId/decision` | Accept exactly `{ choice: "ACCEPT" \| "DECLINE" }`. Returns `{ choice, mutual }`. |
| `GET /matches/decisions?after=` | `{ decisions: [{ id, choice, createdAt, available, mutual }], nextCursor }`. At most 20 of the caller’s own choices per page. The history carries no peer identifier, decision, or explanation. |

The cursor and `pairId` are authenticated encrypted references, bound to
the issuing account, session, route purpose, and a 15-minute lifetime.
`pairId` is the reference received from a recommendation card. It carries
the matching consent generations and an encrypted watermark of existing block
creation audits for the two participants. A new outgoing block by either
participant can require a fresh reference, including after unblock or for a
different blocked account. No additional block history is stored. Withdrawal
of an unrelated consent purpose leaves the matching generation valid. Refresh
an expired page or recommendation. `key` is a stable per-caller opaque UI and tie key.
Development and test can use an ephemeral local key. Production matching
returns `503` without a configured `MATCHING_HANDLE_KEY` containing 32
random bytes encoded as 64 hexadecimal characters. Share it across API
instances. Rotation invalidates outstanding references.

The decision transaction rechecks the current session, both members and
their documented criteria, reciprocal block, and the issued consent state.
It then creates or finds one canonical pair, records one immutable choice
per participant, and writes one metadata-only audit for each new choice.
A repeated same choice with a current reference returns the stored choice
and current mutual status. A different choice receives `409`. Expired,
foreign, blocked, or otherwise no-longer-eligible references receive the
same `404`. Validation failures use `400`, absent or expired sessions
`401`, role or origin denials `403`, unsupported content `415`, and
throttling `429`. Storage or audit errors return a sanitized `503`.

Mutual means that both current participants accepted and the pair remains
eligible. A block writes an invalidation on an existing pair in the block
transaction. A matching-consent withdrawal invalidates the persisted pair
generation. Neither unblock nor regrant restores those decisions as an
active connection. Reopening an invalidated or historical pair requires a
product decision. Legacy pairs lack verified consent stamps. Their rows
and choices are kept, and existing decisions cannot authorize an
interaction. The migration adds integrity and audit triggers and a history
index. Matching history and audit retention, account erasure, and recovery
after backup remain subject to the shared privacy contract.

History is ordered by decision time, with the stored ID as the internal tie
breaker. Each history item exposes an opaque per-caller key in place of the
stored ID. Malformed legacy decisions whose actor is outside the pair are omitted.
The member page is `/account/matches`. It refreshes after submission and on
request, returns to the server on refocus or tab restoration, and clears cards
when hidden, loading, or submitting. Privacy changes apply to subsequent server reads. Data
already received by a browser cannot be recalled.

## Release dependencies

Real grants require approved consent evidence. Real claim creation and
approval also require the existing trusted staff assurance, approved
qualification, assignment provisioning and private-media controls.
Coordinate deployment, protection of the reference key, throttling, and
lifecycle/retention with Hương before real-user rollout. The implementation
does not publish consent terms or enable staff access.
