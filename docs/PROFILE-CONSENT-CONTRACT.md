# C012 draft - Profile, Questionnaire, Preferences and Consent

**DRAFT / PENDING HUONG REVIEW. C012 is not DONE or FROZEN.**

**All unapproved concrete product/policy choices below are PROPOSED / PENDING
HUONG APPROVAL.** Shorter "proposed" or "pending approval" labels have the same
meaning; conditional acceptance of direction does not finalize those choices.

Documentation only for T02/C012 and future C019-C024, not implemented DTOs,
routes, seeds or migrations. [Auth contracts](API-CONTRACT.md) remain unchanged.
Historical scope: `5deaf06:docs/COMMIT-PLAN.csv`, agree response envelopes/types
with Huong and complete contract review.

Review basis: Huong's supplied PR #8 feedback, including the latest technical
review on resource revisions, legacy remediation and retained policy/audit evidence.
**Conditionally accepted** records the second-round conditions, not a completed
PR approval or implementation. Product vocabulary, retention schedules, URL TTL
and remaining mechanism details labeled **PROPOSED / PENDING APPROVAL** need
explicit confirmation. Examples use synthetic data and unapproved policy IDs.

## Decision matrix

| ID | Accepted review direction | Proposed detail / outstanding approval |
| --- | --- | --- |
| D1 | Preserve auth; separate resource wrappers; HTTP 400; dot/index paths; whole-request errors at _form; visible cross-field errors. | Proposed UI placement/unknown-path fallback below; exact new feature codes remain reviewable. Existing auth formatter is unchanged. |
| D2 | GET/default/null rules preserved; validate complete resulting state; never implicitly repair unrelated legacy fields; safe actionable 503; legacy profile/preferences cannot block withdrawal. | Error/remediation steps below specify technical direction; operator escalation and any destructive repair still need separate approval. |
| D3 | Active verified MEMBER, own data, session-derived user ID; staff do not bypass. | No staff access expansion proposed. |
| D4 | Previous MVP thresholds provisionally acceptable only with independent withdrawal capacity; 429 includes Retry-After and is never withdrawal success. | Separate revoke/member and revoke/IP quotas, mixed-batch separation and gateway reservation below need confirmation; no grant/profile bucket may drain them. |
| D5 | Optional draft birthDate; UTC-midnight/date-only storage, UTC age, minimum 18, Feb 29 observed March 1; no matching without birthDate; declaredAdult not verified age. | Do not reinterpret legacy timestamps. Exact remediation and interaction with proposed MVP eligibility ceiling remain review items. |
| D6 | displayName on User; occupation/city max 120 code points, bio max 2000; NFC/outer trim/newlines, whitespace-only rejected, internal bio newlines preserved. | Product catalogs/list caps in section A still await explicit approval. |
| D7 | Version 1; response length 1-2000; stable catalog order; all three answers atomic; retired versions read-only. | Exact keys/prompts, retired-version read selector and catalog evolution in section A need approval; no PENDING_KEY_* product IDs. |
| D8 | Selectable ages 18-120; null bounds unrestricted on that side within MVP eligibility; different goals hard-filter only if explicitly selected; validate merged state. | Exact catalog, priority comparison/defaults and proposed MVP eligibility ceiling in section A await approval. |
| D9 | Server registry, policy-checked grants, policy-less revoke; append-only events, atomic state/evidence; immutable policy content or verifiable hash with corresponding snapshot; retention-safe user deletion. | Technical evidence/de-identification constraints below do not approve retention duration, lawful basis, mapping retention or storage technology. Section B is policy-pending. |
| D10 | Block new API-authorized access/matching contributions before success; async cleanup has retry/owner; issued-URL limitations explicit. | Proposed retention in B and 60-second URL TTL/enforcement in C await approval; outstanding bearer URLs are a stated residual risk. |
| D11 | Separate Profile/Preferences/Questionnaire revisions, expectedRevision and stale-write 409; questionnaireVersion is catalog-only. Preserve separate aggregate consent version/CAS, explicit OFF version advance and idempotent events. | Accepted technical direction is not implemented; physical revision schema and detailed idempotency storage/replay/retention remain reviewable. |

D4/D6/D7/D8/D11 are **not fully approved** merely because their directions are
conditionally accepted. Record reviewer, decision/date and reference for the
remaining values and mechanisms. Product/privacy/legal review of section B is
required; no retention duration below is described as legally mandated.

## Common contracts and ownership

Existing scope requires own-member data, three versioned questionnaire answers
and five separate consent purposes OFF by default. Models are storage, not DTOs.
[Database mapping/gaps](DATABASE.md) distinguish existing fields from proposals.

| Route under /api | Request | Candidate 200 resource wrapper |
| --- | --- | --- |
| GET /profile/me | No body | {revision: number, profile: ProfileReadDto or null} |
| PATCH /profile/me | ProfilePatchDto with expectedRevision | {revision: number, profile: ProfileReadDto} |
| GET /questionnaire/me | No body; optional catalog selector below | {revision: number, questionnaire: QuestionnaireReadDto} |
| PUT /questionnaire/me | QuestionnairePutDto with expectedRevision | {revision: number, questionnaire: QuestionnaireReadDto} |
| GET /preferences/me | No body | {revision: number, preferences: PreferencesReadDto or null} |
| PATCH /preferences/me | PreferencesPatchDto with expectedRevision | {revision: number, preferences: PreferencesReadDto} |
| GET /consents/me | No body | ConsentReadDto |
| PATCH /consents/me | ConsentPatchDto | ConsentReadDto |

The questionnaire wrapper refines the earlier unwrapped example; consent version
fields follow D11's conditional direction. These are future resource contracts,
not deployed routes or changes to auth response shapes.
Each profile/preferences/questionnaire wrapper revision is independent; it is
not the aggregate consent version. Existing auth responses gain no revision.

**Accepted D2/D3:** absent profile/preferences return null, absent answers an
empty array and absent consent purposes OFF, without DB writes. GET must not
create profile, consent, audit or version rows. PATCH omission is unchanged;
[] means empty collection. Non-nullable answers/consents are arrays; interests,
values, dealBreakers and priorities use string[] or null.
Null clears only nullable values, writes database NULL and projects either
database NULL or stored JSON null back as API null. Malformed legacy profile
or preferences must never be read/validated as a prerequisite for withdrawal.

**Proposed details:** reject unknown/privileged fields, empty mutations
(expectedRevision alone is not a resource edit),
duplicate keys/purposes, invalid types and out-of-bound values. Arrays replace
whole fields. No string-to-boolean/number coercion. First profile/preferences
PATCH may upsert with other nullable fields unset and visibility false; no
registration provisioning is implied. Server owns identity/timestamps; response
instants use ISO-8601 UTC. No wrapper changes to current auth responses.

Require current active verified MEMBER on every request, with explicit role and
ownership checks using existing session context. Derive userId from the server,
not browser body/query/URL. Reject userId, role, email, status, verification and
timestamp injection. Staff role does not confer access through these /me routes.
Keep one AuthProvider/client and server authorization before private data reads.
displayName remains on User/AuthUser and is excluded from profile writes;
any future account-name edit needs a separate approved contract/auth refresh.

### Nested field errors - D1 conditional direction and UI placement

New DTO failures use HTTP 400 and the existing VALIDATION_FAILED envelope.
Use dot-separated property names, zero-based decimal array indices,
no brackets or leading dot; e.g. consents.0.policyVersion. Paths use known DTO
keys. Attach cross-field errors to a documented field, e.g. maxAge for an
inverted range; whole-request errors use field _form, not empty details.
**Proposed visible placement:** show maxAge error beside maxAge and in the form
summary linked to it; show a multi-field consent error at _form and beside the
consent group. Show _form at a focusable visible summary, never a hidden control.
Unknown valid-looking paths fall back to that summary. Clients validate paths/
details and never depend on exact message text or render it as HTML.

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Check the submitted fields.",
  "details": [
    { "field": "consents.0.policyVersion", "messages": ["A current policy version is required to grant this purpose."] },
    { "field": "_form", "messages": ["Review the consent choices before submitting."] }
  ]
}
```

This is proposed feature output, not today's auth formatter behavior. Auth
currently produces top-level field names. Any future nested formatter/form
integration needs tests and must preserve existing auth behavior.

## Feature security and independent withdrawal quotas - D4 provisional

Reuse exact configured Origin and application/json policy for PATCH/PUT.
Do not copy auth-specific action buckets. Current AuthRequestGuard uses
15-minute windows: register 20/IP, resend 10/IP, other auth actions 60/IP,
plus login 10/normalized identity; its bounded map allows 10000 entries.
Thresholds are hardcoded, not existing feature environment settings.
Proxy trust stays disabled; use socket-derived IP, never untrusted forwarding.

| Proposed feature bucket | Candidate limit/window | Key |
| --- | --- | --- |
| All four GET routes | 120 / 60 seconds | authenticated member ID, shared read bucket |
| Profile PATCH | 20 / 60 seconds | member ID + profile mutation |
| Preferences PATCH | 20 / 60 seconds | member ID + preferences mutation |
| Questionnaire PUT | 10 / 60 seconds | member ID + questionnaire mutation |
| Consent grants/re-consent | 60 / 60 seconds | member ID + consent-grant mutation |
| Non-withdrawal feature ceiling | 600 / 60 seconds | socket IP, excluding revocation-only requests |
| Revocation-only PATCH | Proposed 60 / 60 seconds, independent reserve | member ID + consent-revoke bucket |
| Withdrawal IP ceiling | Proposed 600 / 60 seconds, independent reserve | socket IP + consent-revoke bucket |

Original MVP thresholds are provisionally accepted, not production guarantees.
The two separate reserve values are **PROPOSED / PENDING APPROVAL**. A valid
revocation-only batch contains only granted=false entries (including already-OFF).
It bypasses grant/profile/read/general-feature counters, uses its own member/IP
quotas and still requires session/MEMBER/Origin/JSON checks. A grant never uses
the withdrawal reserve. Proposed mixed grant/revoke batches fail 400 at _form;
UI submits withdrawal separately, without automatically retrying either action.
Confirm this classification and gateway-level reserved capacity before release;
an upstream shared limiter must not defeat the separation. Shared proxy IPs can
still share the dedicated IP quota, so verify realistic withdrawal load.

429 always includes Retry-After for both lanes and this rejected attempt changes
no state/version/success event. It must never be presented as withdrawal success;
reconcile any earlier ambiguous attempt separately rather than inferring its
outcome from a later 429. Bounded counters, guard
order and restart/multi-process behavior need confirmation. Do not enable proxy
trust or add Redis as part of this draft; no limiter implementation is changed.

## JSON null and legacy rows - D2 conditional mapping

Database NULL and JSON null differ in storage. Accepted mapping is API null as
cleared/unset, distinct from [] as explicitly empty; apply this future contract:

| Input/storage | Conditional mapping / safe legacy direction |
| --- | --- |
| PATCH key omitted | Leave stored value unchanged |
| PATCH null | Write database NULL, not JSON null; use Prisma database-null handling when needed |
| PATCH [] | Store JSON empty array |
| Valid nonempty array | Store approved normalized array |
| GET database NULL or JSON null | Return API null without backfill |
| Legacy valid array | Return only if valid under approved read/catalog rules |
| Legacy object/scalar/invalid array | Never silently coerce, filter, erase or rewrite |

**Accepted technical direction:** an authorized read or a mutation whose complete
result remains malformed fails safely with 503 DATA_SHAPE_UNAVAILABLE. Do not
return a partial resource as success, silently repair an unrelated field, drop
unknown legacy keys, normalize omitted storage or delete malformed rows. Merge
only explicitly submitted fields, preserving untouched values, then validate the
entire candidate resource before committing any state/revision change. Invalid
new request fields are 400; malformed persisted data still present in the result
is 503. A stale revision is 409, not permission to overwrite/repair.

This check addresses one resource, not the whole account. Consent withdrawal
must not load/validate profile/preferences/questionnaire projections or catalogs;
their errors cannot block or contaminate a withdrawal response.

### Safe legacy error and explicit remediation workflow

For the authorized owner only, return a generic message, resource name, current
resource revision and allowlisted field paths identifying what needs attention:

```json
{
  "code": "DATA_SHAPE_UNAVAILABLE",
  "message": "Stored profile data needs review before this change can be saved.",
  "resource": "profile",
  "revision": 3,
  "details": [
    { "field": "interests", "messages": ["Explicitly replace or clear this field before saving."] }
  ],
  "remediation": { "action": "EXPLICIT_REPLACEMENT_REQUIRED", "fields": ["interests"] }
}
```

No raw stored/submitted values, unknown JSON property names, other user IDs,
SQL/stack traces, policy text, tokens or private content appear in this error.
Use schema-known paths; use _form if a malformed shape cannot be located safely.
The revision is a concurrency token, not disclosure of another member's state.
This is future feature output, not an implemented auth error. Do not add a
Retry-After unless a real temporary recovery deadline is known; blind retry
cannot fix malformed data.

1. Reject the write atomically; keep original data and revision unchanged. Show
   visible affected-field/_form errors and preserve the user's unsaved edits.
2. Let the owner explicitly choose replacement or permitted null/[] clearing
   for each affected field. Never preselect destructive clearing or send a
   default-filled full PATCH that overwrites valid fields the UI cannot read.
3. Submit precise corrections with the reported expectedRevision after explicit
   confirmation. Re-read storage in the transaction, merge only submitted keys
   and validate the complete result. Commit all changes/revision together only
   when valid; remaining malformed fields still yield 503.
4. Questionnaire PUT still supplies all three approved answers, but cannot
   silently delete malformed/unknown legacy rows outside the submitted catalog
   scope. Cases normal DTOs cannot safely express need a separately reviewed
   owner-assisted/operator remediation plan, not a generic repair API.
5. That plan names exact rows/fields, authorization, dry-run findings, owner/
   policy approval, rollback and verification. Any quarantine/backup needs
   retention approval. Record minimal repair evidence without raw text; review
   does not grant staff a /me bypass. No automatic destructive migration,
   background repair or GET-side backfill is authorized by this document.

The UI keeps independent withdrawal available throughout remediation. Cleanup
projection failures are retried after access removal, never used to undo an
otherwise-valid successful withdrawal.

## Resource editing revisions - accepted technical direction, not implemented

Profile, Preferences and Questionnaire each have a server-owned nonnegative safe
integer revision scoped to member + resource. GET returns it in the wrapper;
PATCH/PUT must send expectedRevision. Missing/invalid expectedRevision is HTTP
400 at that field. A stale value is HTTP 409 RESOURCE_REVISION_CONFLICT at _form,
with no write, partial questionnaire save or revision increment.

No resource shares another's counter: editing a profile cannot consume a
preferences/questionnaire revision or any consent version. Questionnaire's one
editing revision covers that member's questionnaire answer resource across
catalog versions; questionnaireVersion selects the catalog, never authorizes an
overwrite. A retired-version GET returns that resource's current editing revision
with the requested saved catalog snapshot; retired versions stay read-only.

Before creation, revision 0 is virtual and GET writes nothing. First write must
enforce unique member/resource initialization and CAS with the data transaction.
Later writes authorize, read current revision/data, compare expectedRevision,
validate request and complete merged resource, apply the conditional write and
increment exactly once. Any failed comparison/validation/write rolls back all
changes. Clearing/removing a data row must not reset the resource revision during
account lifetime. An accepted nonempty mutation consumes a revision even when
submitted values equal current values; that equality is not idempotency.
Existing-row initialization and the physical storage design require review
before implementation; no write path may bypass CAS once enabled.

```json
{
  "code": "RESOURCE_REVISION_CONFLICT",
  "message": "This resource changed. Reload and review your edits before saving.",
  "details": [{ "field": "_form", "messages": ["Reload before submitting again."] }]
}
```

Keep unsaved edits after 409, fetch fresh data/revision and require explicit user
review before resubmission. Never silently merge and retry a mutation. Consent
expectedVersion/version/CAS/idempotency below remains separate; expectedRevision
must not replace or reset that consent mechanism.

## A. Product catalog and questionnaire - vocabulary PENDING APPROVAL

All vocabulary/compatibility/ranking choices in this section are concrete
proposals for explicit Huong/product approval, not requirements found in code.
The conditional numeric/date/normalization directions are labeled separately.

### Profile DTOs, validation and candidate catalogs

```ts
type ProfilePatchDto = {
  expectedRevision: number;
  birthDate?: string | null;
  occupation?: string | null;
  city?: string | null;
  bio?: string | null;
  relationshipGoal?: string | null;
  interests?: string[] | null;
  values?: string[] | null;
  visibilityEnabled?: boolean;
};
type ProfileReadDto = {
  birthDate: string | null;
  occupation: string | null;
  city: string | null;
  bio: string | null;
  relationshipGoal: string | null;
  interests: string[] | null;
  values: string[] | null;
  visibilityEnabled: boolean;
  updatedAt: string;
};
```

**Conditionally accepted D6 normalization:** free text NFC, trim surrounding whitespace, normalize
CRLF/CR to LF, preserve internal whitespace. Reject blank strings; explicit null
clears nullable scalar text. Count Unicode code points after normalization.
Catalog IDs are exact case-sensitive ASCII; reject unknown/duplicate IDs rather
than guessing aliases. Lists preserve supplied order except catalog-ordered
questionnaire responses. None of this changes auth normalization.

| Field | Conditional validation / candidate catalog |
| --- | --- |
| occupation / city | Accepted max 120 Unicode code points each; non-null whitespace-only text rejected |
| bio | Accepted max 2000 Unicode code points, reject whitespace-only; preserve internal newlines |
| relationshipGoal | Proposed: long-term (seeking a long-term relationship), exploring (exploring relationship intentions); null unset |
| interests | Proposed max 7 distinct IDs: reading, music, cooking, outdoors, sport, travel, creative-arts |
| values | Proposed max 7 distinct IDs: kindness, honesty, communication, family, independence, personal-growth, community |
| visibilityEnabled | Non-null boolean, default false; never grants consent |

Goal IDs overlap UI preview examples, but are not approved product vocabulary.
Catalogs and list caps remain proposals. Accepted text lengths do not approve
the catalog values or future matching use of them.

**Accepted D5:** birthDate may be absent while saving an incomplete draft.
**Conditionally accepted D5 algorithm:** real Gregorian YYYY-MM-DD on the wire; store UTC
midnight in existing DateTime and serialize UTC date components. Use server UTC
calendar date, subtract birth year and subtract one if birthday has not occurred.
For February 29 in a non-leap year, birthday is March 1. Reject future dates and
supplied dates yielding age under 18. The MVP upper eligibility proposal below
is still pending, not a universal upper birth-age rule. Ambiguous legacy
timestamps need review, not silent timezone conversion.

**Conditional matching direction:** missing/invalid/ambiguous age excludes the member on
both sides until corrected; draft saving/owner access remain available. Never
infer age from declaredAdult, preferences, video or questionnaire. Other
active/verified, consent, visibility, block and reciprocal gates still apply.
A birth date is self-reported; declaredAdult is not verified age or identity.

Synthetic PATCH and response using candidate vocabulary:

```json
{ "expectedRevision": 0, "occupation": "Synthetic occupation", "interests": ["reading"], "visibilityEnabled": false }
```

```json
{
  "revision": 1,
  "profile": {
    "birthDate": null,
    "occupation": "Synthetic occupation",
    "city": null,
    "bio": null,
    "relationshipGoal": null,
    "interests": ["reading"],
    "values": null,
    "visibilityEnabled": false,
    "updatedAt": "2026-11-15T00:00:00.000Z"
  }
}
```

### Questionnaire - exact vocabulary PENDING APPROVAL

The plan establishes three answers, not their keys/prompts. **Conditionally
accepted initial questionnaireVersion: 1**, with exactly three proposed entries:

| Order | Proposed key | Proposed English prompt |
| --- | --- | --- |
| 1 | relationship-intention | What are you hoping to build in a relationship? |
| 2 | everyday-life | What does a good ordinary day look like for you? |
| 3 | values-and-boundaries | Which values and boundaries matter most to you in a relationship? |

Conditionally accepted responseText length: 1-2000 characters; propose the same
Unicode-code-point measurement/normalization as profile text. Blank is invalid.
The keys/prompts still require explicit approval; do not seed them yet.
PENDING_KEY_* from earlier examples are never product keys.

```ts
type QuestionnairePutDto = {
  expectedRevision: number;
  questionnaireVersion: number;
  answers: { questionKey: string; responseText: string }[];
};
type QuestionnaireReadDto = {
  questionnaireVersion: number;
  answers: { questionKey: string; responseText: string; updatedAt: string }[];
};
```

**Accepted direction:** all three distinct answers for one supported version
must validate and save in one transaction. Reject partial sets, unknown/
duplicate keys, blank answers or mixed/unsupported versions. No partial success
or implicit deletion. **Proposed GET:** wrapper questionnaire with current
version and answers: [] before any save; saved answers in catalog order with
server updatedAt and normalized text. Retain older-version rows; expose current
version by default. Retired versions are read-only, not rewritten as version 1.
Proposed read selector: GET /questionnaire/me?questionnaireVersion=<integer>
returns that known current/retired catalog and only the caller's saved answers;
unknown versions fail 400, PUT to a retired version fails 409
QUESTIONNAIRE_VERSION_RETIRED with a visible _form error. Saved answers remain
readable until their separately approved retention expiry. Stable catalog order
is accepted; exact selector/status remains reviewable. Separate expectedRevision/
revision rules above apply; questionnaireVersion is catalog-only, not a
write-conflict token.

```json
{
  "expectedRevision": 0,
  "questionnaireVersion": 1,
  "answers": [
    { "questionKey": "relationship-intention", "responseText": "Synthetic intention." },
    { "questionKey": "everyday-life", "responseText": "Synthetic routine." },
    { "questionKey": "values-and-boundaries", "responseText": "Synthetic boundaries." }
  ]
}
```

Success returns the advanced wrapper revision plus questionnaire containing
saved catalog version/answers and per-answer updatedAt.

### Preferences, compatibility and priority ordering - catalog PENDING APPROVAL

```ts
type PreferencesPatchDto = {
  expectedRevision: number;
  minAge?: number | null;
  maxAge?: number | null;
  relationshipGoal?: string | null;
  dealBreakers?: string[] | null;
  priorities?: string[] | null;
};
type PreferencesReadDto = {
  minAge: number | null;
  maxAge: number | null;
  relationshipGoal: string | null;
  dealBreakers: string[] | null;
  priorities: string[] | null;
  updatedAt: string;
};
```

**Conditionally accepted bounds:** selectable non-null ages are integers 18-120.
Null bounds are unrestricted on that side within approved MVP eligibility.
**Proposed MVP eligibility: known self-reported age 18-120 inclusive** on both
sides, independent of whether either preference bound is null. This upper
eligibility cutoff is a new product proposal, not a fact about human age or
approval implied by selectable bounds. Confirm it explicitly. Unknown age
remains ineligible. Validate merged persisted + PATCH values, including
minAge <= maxAge when both exist, and write the whole change atomically.

relationshipGoal uses the proposed profile catalog; null means no goal target.
Different goals are NOT a hard exclusion by default, including when a goal
preference is set. Proposed dealBreakers catalog contains only
different-relationship-goal (max 1 distinct ID). Only when explicitly selected,
require both members' non-null profile goals to be equal; missing goals then
fail this selected condition. The member's desired relationshipGoal remains a
soft ranking target and does not silently enable that hard filter. Under this
candidate catalog, long-term and exploring are compatible without the selected
filter, equal-only with it. No inferred traits or executable user filters.

Proposed priorities: max 3 distinct IDs from relationship-goal, values, interests.
Use descending lexicographic criterion order, not unspecified weights: compare
the first criterion, then the next only on equality. Candidate criterion values:
relationship-goal is 1 for a known exact match to the member's non-null target,
otherwise 0; values/interests are Jaccard overlap of approved self-reported
catalog-ID sets (intersection/union), 0 when missing or the union is empty.
These are heuristic preference measures, never romantic-success probabilities.
[] applies no optional ranking criteria; proposed null default order is
relationship-goal, values, interests. Break final ties deterministically using
an opaque recommendation key, not sensitive fields. Apply reciprocal hard
eligibility first; this directional ranking does not finalize T14's reciprocal
aggregation. All ordering/default/formula/catalog choices are PENDING APPROVAL
and need Phuc/Huong matching review. They never override a hard constraint.
Malformed persisted ranges follow the 503/remediation workflow. Complete merged
state validation never silently repairs an omitted bound.

### Catalog compatibility and versioning - PROPOSED / PENDING APPROVAL

Propose a server-owned catalog revision named profile-catalog-v1 for the above
goal/interest/value/dealbreaker/priority IDs. It is not a policy version, auth
role or consent version. No approved registry or stored catalog revision exists
today. IDs are exact, unique and case-sensitive; reject aliases, duplicates and
unknown IDs. Prompts/labels may later be localized without changing meanings.
Do not reuse an ID for changed meaning. Append new approved IDs in a new catalog
revision; retired IDs remain readable under their original meaning but are not
accepted in new writes. Legacy unsupported IDs follow safe legacy handling,
not silent remapping. Review whether persisted catalog provenance needs new
storage before C019-C024; do not add schema here.

Questionnaire keys are scoped by questionnaireVersion; any prompt/meaning
change creates a new approved version, preserving the old catalog/order.
Version 1 has exactly the three candidate prompts above. Retired versions are
read-only until retention expiry, and no automatic answer migration is implied.

```json
{
  "expectedRevision": 0,
  "minAge": 25,
  "maxAge": null,
  "relationshipGoal": "long-term",
  "dealBreakers": ["different-relationship-goal"],
  "priorities": ["values", "interests"]
}
```

Response includes the advanced wrapper revision and complete valid merged state
in preferences with server updatedAt.
Saving preferences never grants consent or activates visibility.

## Consent and immutable audit - D9/D10

Proposed request header for consent mutations: Idempotency-Key, as specified in
D11 below. This is a new feature contract, not an existing auth requirement.

The existing purpose enum contains PROFILE_MATCHING, VIDEO_STORAGE,
EXPERT_VIDEO_REVIEW, REPORT_SHARING, VIDEO_CLAIM_MATCHING. Each is independent,
OFF by default; no auto-grant or bypass of claim QA/owner sharing.

```ts
type ConsentPurpose =
  | "PROFILE_MATCHING" | "VIDEO_STORAGE" | "EXPERT_VIDEO_REVIEW"
  | "REPORT_SHARING" | "VIDEO_CLAIM_MATCHING";
type ConsentPatchDto = {
  expectedVersion: number; // proposed, not currently persisted
  consents: {
    purpose: ConsentPurpose;
    granted: boolean;
    policyVersion?: string; // grant requires current policy; revoke does not
  }[];
};
type ConsentStateDto = {
  purpose: ConsentPurpose;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  policyVersion: string | null;
  updatedAt: string | null;
};
type ConsentReadDto = {
  version: number; // proposed per-member aggregate consent revision
  consents: ConsentStateDto[];
};
```

**Conditionally accepted direction:** server validates policy version on grant; revocation is
not blocked by missing policy. Save current state and immutable events atomically.
Existing schema cannot yet hold all that evidence; no migration is made here.

**Conditional policy direction:** server-controlled per-purpose current-policy registry.
Grant requires exact current supported ID; absent/unknown/stale ID returns 400
at consents.<index>.policyVersion. Revoke can omit it and ignores a supplied
well-typed policy ID for eligibility; invalid DTO types/purposes still fail.
Confirm treatment of stale supplied IDs independently and registry ownership/
rollout/re-consent. PENDING_POLICY_VERSION below is not an approved policy.

GET returns five states in enum order; missing rows project false and null
timestamps/policy, no writes. Proposed initial aggregate version is virtual 0.
Current policyVersion retains last accepted grant policy after revoke; no
accepted grant yields null. Proposed grantedAt retains last grant, revokedAt
records latest revoke and is cleared on a new grant. These details need approval.

PATCH has a nonempty distinct-purpose set, literal booleans and expectedVersion.
Server assigns actor/member, timestamps and next version. Within one transaction,
validate policy/state, compare revision, update state/revision and append events.
Proposed immutable evidence: event ID, retention-safe subject/actor references
derived from server context (not client IDs or raw email),
purpose, old/new granted state, applicable accepted policy (or prior/null on
revoke), server time, operation kind and old/new aggregate version.
Do not store passwords, tokens, raw media or private profile text in events.
Dedicated event model versus AuditLog extension, retention and access require review.
Distinguish event kinds: proposed STATE_CHANGED for boolean changes,
OFF_REAFFIRMED for explicit false when already false, GRANT_REAFFIRMED for an
unchanged grant/policy, and POLICY_RECONSENT when true remains true but accepted
policy changes. Reaffirmation must not be mislabeled as a state change.
Exact event vocabulary remains proposed. Events are immutable while retained;
approved expiry/deletion is a privileged retention action, not event editing.

### Append-only audit and immutable policy evidence - accepted technical direction

Consent events are append-only: no application UPDATE/DELETE, replacement,
rewriting on account deletion or mutation of old evidence during policy rollout.
Corrections append a new linked event rather than editing the original. The
approved expiry/erasure workflow is a separately authorized retention operation,
not ordinary event CRUD. State, aggregate consent version, event and idempotent
result commit atomically; failure rolls back the entire consent mutation.

Every accepted grant/re-consent binds to immutable policy evidence: purpose,
policyVersion, locale, effective policy identity, exact accepted content snapshot
or verifiable content hash AND the corresponding retained policy snapshot.
A version label, mutable URL, or hash without a recoverable matching snapshot is
insufficient. Keep the presented policy/notice content and its encoding/
canonicalization rules stable; proposed digest is SHA-256 over the documented
UTF-8 snapshot bytes. Record algorithm/digest/snapshot reference and enough
presentation context to identify what the member accepted, without storing raw
profile/video content. Snapshot reads must verify the digest; no mutable latest
policy lookup may substitute for evidence of an earlier grant.

Policies are versioned, never edited in place. A material text/purpose/locale
change creates new evidence, without rewriting previous grant events. Snapshot
retention covers every referencing event's approved retention and relevant
backup/hold obligations. Registry retirement can stop new grants but cannot
delete evidence still required by retained events. Revoke requires no new policy;
its event references prior evidence when available and must not depend on
rendering or accepting a new policy. Do not fabricate evidence for legacy grants
whose policy snapshot is missing: retain an explicit evidence-gap marker and
require policy-reviewed handling/re-consent, without blocking withdrawal.

Future implementation needs an immutable policy-evidence store, append-only
event records/permissions and durable references with deletion restrictions, not
cascade from User or policy registry entries. Current Consent/AuditLog do not
provide this structure. A retained snapshot can be content in a protected record
or a verified immutable artifact; exact storage technology is still reviewable.
Retention duration, legal basis, access roles and exceptions remain PENDING
HUONG/PRIVACY/LEGAL APPROVAL; technical append-only direction does not approve
the candidate periods in section B.

### Retention-aware account deletion and de-identification

Before hard-deleting User, revoke sessions/access immediately and durably record
cleanup obligations. Preserve required consent events, policy snapshots and
unexpired audit evidence independent of deletable User/Consent rows. A cascading
User -> Consent delete must not transitively erase audit events; future relations
must prohibit that path and restrict premature deletion of referenced evidence.
Audit retention cannot be implemented merely by leaving raw user IDs in logs.

Use stable random audit-subject/actor references independent of the live User PK,
with a separate tightly controlled identity mapping where a lawful approved need
exists. Events contain no email, account name, session token or raw content.
On approved deletion, erase or minimize the separate mapping and identity data
according to policy rather than rewriting immutable events. Event order, consent
version links and policy digests remain verifiable after User removal.
Pseudonymous references may still be personal data; do not claim anonymity or
legal compliance merely because direct identifiers were removed. Any retained
link, re-identification access, timestamp granularity, mapping-key lifecycle and
deletion/hold exception needs privacy/legal approval and access auditing.

Production event creation needs an approved retention rule/expiry basis; the
draft 365-day proposal is not that approval. Deletion must verify event/snapshot
expiry/holds before any audit purge and explicitly surface policy uncertainty,
not treat it as an indefinite default hold or declare full erasure. Backup
restore must preserve approved mapping erasure and deletion suppression before
traffic resumes. Legacy audit with direct identifiers needs a separately
reviewed migration/de-identification plan; no automatic rewrite/delete here.
No data retention schedule or legal right is decided by these technical rules.

**New proposal replacing prior no-op rule:** every accepted consent mutation,
including explicitly reaffirming already-OFF, consumes a version and records an
event. OFF reaffirmation forms a barrier against stale grants. A repeated old
request fails its version check rather than generating duplicate success events.
Reaffirmation/event semantics remain PENDING APPROVAL under D9/D11.

```json
{
  "expectedVersion": 0,
  "consents": [
    { "purpose": "PROFILE_MATCHING", "granted": true, "policyVersion": "PENDING_POLICY_VERSION" }
  ]
}
```

```json
{
  "expectedVersion": 1,
  "consents": [{ "purpose": "PROFILE_MATCHING", "granted": false }]
}
```

After this illustrative grant/revoke, success would return aggregate version 2
and five states; one example item is:

```json
{
  "purpose": "PROFILE_MATCHING",
  "granted": false,
  "grantedAt": "2026-11-14T00:00:00.000Z",
  "revokedAt": "2026-11-15T00:00:00.000Z",
  "policyVersion": "PENDING_POLICY_VERSION",
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

### Withdrawal guarantees

**Accepted D10:** once revoke succeeds, block new unauthorized access and remove
the affected contribution from matching. Read current authoritative consent;
invalidate/exclude stale recommendation/explanation data. Physical deletion,
assignment closure and retention cleanup may run asynchronously with tracked
server-side retry, but failure must not restore access or issue new signed URLs.

Previously issued signed URLs may remain usable until expiry unless supported
enforcement can revoke them. Do not promise instant byte erasure, revocation
of downloaded copies or stronger URL invalidation than the system supports.
Agree expiry/enforcement, in-flight operations and cleanup/retention duties
before private-media release.

## Optimistic concurrency and idempotency - D11 conditional design

Use one persisted, monotonically increasing aggregate consent version per
member, separate from updatedAt and questionnaireVersion. GET returns version
and all states from a consistent snapshot; PATCH supplies a nonnegative safe integer
expectedVersion. Server owns next version; no GET writes. Initial virtual 0
is materialized only during the first mutation, uniquely per member.

Transaction: recheck account/ownership, initialize revision safely if needed,
compare-and-swap where stored version equals expectedVersion, update purposes,
increment once and append immutable events. Any comparison/write/audit failure
rolls back all changes. Purpose deletion/recreation cannot reset the aggregate
revision in the account lifetime. Every accepted mutation, including already-OFF
reaffirmation, advances the version, preventing that no-op from leaving a stale
grant eligible.

Proposed stale-write response is HTTP 409:
```json
{
  "code": "VERSION_CONFLICT",
  "message": "Consent changed. Reload before submitting again."
}
```

Missing/invalid expectedVersion is 400. After a conflict, re-read and require a
new explicit user action; never automatically replay grants with a new version.
After network uncertainty, do not silently retry; a user-requested reconciliation
may reuse the original idempotency key and identical payload as described below.
Example: both tabs read version 4. Revoke (even reaffirming OFF) commits version 5.
An older grant with expectedVersion 4 gets 409, changes nothing and adds no success
event. A fresh explicit grant at latest version/current policy can still succeed.
If the grant wins first, the stale revoke fails visibly and must be explicitly
resubmitted after refresh; never claim unsuccessful withdrawal succeeded.

This orders committed operations, not wall-clock age of unsent intentions.
Revision storage, lifetime, events and recovery need implementation review before
C023. Current schema/code do not provide this safety. Profile/preferences/
questionnaire use the separate expectedRevision/revision contract above;
consent's aggregate version does not protect or consume those resource revisions.

### Idempotency-Key proposal - exact details PENDING APPROVAL

Require Idempotency-Key on each consent PATCH. Proposed format: 16-128 ASCII
letters/digits/hyphen/underscore, with a fresh cryptographically random client
key per explicit operation. Scope uniqueness by member + consent resource + key,
not by tab or IP. Hash a canonical payload fingerprint including expectedVersion,
purpose set, granted values and submitted policy IDs; no tokens or profile text.

In the same transaction as CAS/state/events, insert an idempotency result record
with unique scoped key, fingerprint, operation version and response snapshot.
Concurrent identical requests must serialize on that uniqueness: exactly one
commits a version/event set. Matching-key/matching-payload replays return the
original committed result with proposed Idempotency-Replayed: true, without
revalidating a grant into a new operation or incrementing anything. Authorize the
current account/session on every replay; deletion/suspension cannot be bypassed.
Same key with a different payload returns 409 IDEMPOTENCY_KEY_REUSED at _form,
with no mutation. Uncommitted transaction failure must not leave a success record.

Propose result retention of 24 hours after commit (section B), not permanent
key storage. After expiry, an old request's expectedVersion is still stale:
CAS must reject it rather than create duplicate events/versions. Do not reset
aggregate versions when idempotency records expire. A replay confirms the
historical result, not the current consent state if a newer operation exists;
the UI re-reads current state before claiming present access/consent. A new
action after 409 uses refreshed state and a new key, never an automatic grant.
Confirm canonicalization, storage/retention, replay headers and conflict UI.

## B. Data retention and deletion - PROPOSED / PENDING POLICY APPROVAL

**None of these periods is a legal requirement or an approved production policy.**
They are concrete review candidates and operational targets, not an erasure SLA
already implemented. Huong/product/privacy/legal reviewers must approve purpose,
jurisdiction, retention notice, user rights, exceptions and backup constraints
before real data use. Current cascading FKs are not a retention implementation.

Authorization removal is synchronous and independent of physical deletion.
Withdrawing one purpose disables that use; it does not automatically delete all
profile data authorized for another purpose or grant another consent. Explicit
data/account deletion is a separate trigger. No indefinite legal hold by default:
an exceptional hold needs authorized scope/reason/expiry/access review and cannot
restore matching or media privileges. Its lawful basis is unresolved.

| Data category | Proposed active retention / deletion trigger | Immediate authorization effect | Proposed physical deletion target / owner |
| --- | --- | --- | --- |
| Profile | Current owner data while account active; field clear or account deletion triggers removal | Clear removes active value synchronously; matching consent withdrawal removes matching use, not unrelated owner access | Active cleared value removed in its write; full profile within 7 days of account deletion. Phuc owns domain cleanup; Huong coordinates account workflow |
| Preferences | Current configuration while active; clear/account deletion | Stop affected matching use immediately; no stale recommendation/explanation serving | Cleared active fields in write; full row within 7 days of account deletion. Phuc |
| Questionnaire | Current version while active; retired saved versions up to 90 days after retirement; explicit answer/account deletion | Deleted/expired answers not readable or matchable; retired versions read-only before expiry | Within 7 days of deletion request, account deletion or 90-day expiry. Phuc; no automatic answer migration |
| Consent current state/revision | Keep while account exists, including OFF state/version to prevent stale grants; account deletion starts purge | Revoke applies before success; account deletion denies all sessions/access immediately | Purge within 7 days of account deletion after required audit/cleanup evidence is safely captured. Phuc + Huong; never reset active-account version |
| Immutable consent audit | Proposed 365 days after each event solely for approved accountability purpose; not yet an approved expiry rule | Restricted audited access only; never input to matching or general member/staff browsing | No User/Consent cascade; privileged expiry purge only after approved retention/holds. Delete/minimize a separate identity mapping where approved, not immutable event fields. Huong privacy owner + Phuc event storage; final retention/de-identification unresolved |
| Policy evidence/snapshots | Retain at least as long as all referencing events need them under approved retention/hold/backup rules; no new numeric duration proposed | Evidence access restricted; registry retirement cannot invalidate historical proof | Reject premature snapshot deletion; verify content/hash availability until all approved obligations expire. Huong policy/privacy + Phuc consent evidence; storage/retention approval pending |
| Video metadata | While object exists/authorized workflow active; VIDEO_STORAGE withdrawal, video delete or account delete triggers removal | Deny new issuance/access first; cancel/close dependent work | Purge within 7 days of trigger, after object-deletion verification; retain only necessary cleanup locator until confirmed. Huong, coordinated with Phuc assignment/review ownership |
| Video object files and versions | While VIDEO_STORAGE remains granted and owner has not deleted; storage withdrawal/delete/account delete triggers purge | Block new API-authorized access/URLs immediately; existing capability limitation in section C | Proposed within 24 hours of trigger for originals, derived copies, object versions and abandoned multipart data. Huong storage owner; verify provider behavior |
| Expert reviews/observations/claims | While authorized private review/report purposes remain; source storage withdrawal/video/account deletion triggers review-data purge proposal | Review-consent withdrawal blocks new expert work; report/share/matching withdrawals independently remove only the affected use immediately | Proposed purge raw review/observations/claims within 7 days of source-video/storage/account deletion. Review-only withdrawal closes work without automatically deleting separately authorized owner report; retained-report scope still needs approval. Phuc + Huong privacy |
| Account/User and auth records | Owner deletion request starts workflow, not an unapproved reversible grace period | Set account unavailable, revoke sessions, deny future access and matching immediately | Proposed hard deletion within 7 days, coordinating objects and removing approved identity mappings while protecting unexpired audit/snapshots from cascade. Surface policy/retention conflicts; no silent evidence loss or false erasure claim. Huong |
| Consent idempotency records | Proposed 24 hours after committed result; only minimal consent snapshot/fingerprint, no credentials | Replay always checks current authorization; cannot create events/versions | Delete after 24 hours; aggregate revision remains. Phuc with Huong privacy review |
| Cleanup evidence | Minimum non-content job/status evidence until verification; proposed 30 days after verified completion | Operational access only; never used for matching | Remove locators after verification; purge minimized completion evidence after 30 days. Domain owner, coordinated by Huong |

**Backup proposal:** encrypted restricted backups roll off within 35 days after
a record/object was deleted from active storage; no normal-user access. Audit
retention expiry may therefore leave a backup copy for up to 35 additional days.
Keep a deletion/revocation suppression ledger until the last affected backup
expires, so restore re-applies restrictions/deletions before serving traffic.
That ledger's exact minimal fields and retention need approval; do not erase it
early because a live row was purged. No "fully erased" claim until active data,
object versions, replicas and applicable backups are verified gone or explicitly
reported as pending. Confirm actual provider versioning/backup capabilities.

### Cleanup ownership, retries, failure and verification

**PROPOSED:** persist a durable cleanup task in the same transaction that records
withdrawal/deletion obligations, alongside consent/audit where applicable. The
existing schema has no such outbox/job model. Use deterministic job identity
and idempotent deletion; never enqueue solely in volatile process memory.
For a deletion job attempt immediately, then after 1 minute, 5 minutes, 30
minutes, 2 hours, 6 hours and every 6 hours thereafter. Retry intervals and
retention targets need approval, not a new queue dependency today.

Raise a privacy-owner alert by 24 hours of unresolved object cleanup (or sooner
on permission/configuration failure), and escalate any missed category deadline.
Keep failed jobs actionable for manual repair; never restore consent, hide the
failure or discard the only locator needed to delete. Do not repeatedly log
private URLs/content or copy data into error reports. A cleanup failure must
not turn successful authorization withdrawal into restored access.

Huong owns account/privacy/storage coordination; Phuc owns profile/questionnaire/
preference and review/assignment domain effects. Each job has a named owner and
audited status. Verify database row removal, inaccessible/deleted object and all
versions/derived copies, canceled work, excluded claims/matches and cache removal.
Distinguish DELETE acknowledgement from verified deletion; verify retries,
restart recovery, backup restore suppression and failure alerts with synthetic
fixtures. Do not promise production deletion until all stores are inventoried.

## C. Signed video URL security - PROPOSED / PENDING APPROVAL

**Candidate TTL: 60 seconds from issuance**, with server-generated expiresAt;
renewal needs a fresh authorized API request. This is a short proposed MVP
playback-URL lifetime, not implemented or approved provider behavior. Upload URL
TTL is separate and must not be silently inferred from this playback proposal.

Before issuing each private GET/HEAD/range capability, validate the current
session/account and server-derived requester identity, exact video/object scope,
non-deleted playable video state (proposed READY or UNDER_REVIEW), current
VIDEO_STORAGE consent and owner authorization. An expert additionally needs
EXPERT role, approved eligibility/training, required staff MFA, active assignment
to this video and current EXPERT_VIDEO_REVIEW consent. Re-check on renewal;
role alone, old assignment or a cached consent flag is insufficient. Owner
access does not require granting expert-review consent. No public ACL, permanent
URL, list permission or caller-selected bucket/key is accepted.

Synchronize issuance authorization with withdrawal using the approved consent/
resource revision/locking boundary. No authorization for a new URL may be
created after withdrawal commits. A capability issued before that commit may
arrive at the client later; it remains a previously issued capability subject
to the limits below, not a reason to mint replacements after withdrawal.
Document/check in-flight playback, signing and object-deletion races explicitly.

Propose API response fields url and expiresAt, with no public object-key metadata.
Both issuance responses and private object responses must use private, no-store,
max-age=0 cache policy, including signed response cache overrides when supported.
No CDN/shared-cache/service-worker persistence, localStorage or database storage
of signed URLs. URLs are bearer secrets: redact query strings from logs,
analytics, error reports and referrers; no-referrer on the player. HTTPS and
private-bucket access are release gates. Browser-buffered bytes cannot be erased
by a cache header; the UI stops/clears revoked playback but is not enforcement.

### Existing-capability limitations and invalidation candidates

A direct signed URL already issued may remain usable until expiry unless storage
supports effective revocation. Expiry usually controls acceptance of subsequent
requests, not guaranteed termination of an already-authorized stream; range
requests/renewals must be checked according to actual provider semantics. Do not
promise single-use URLs, immediate stream termination or erasure of downloads.
New API issuance and matching access are denied before revoke success; residual
previously issued capability access must be disclosed and approved as a risk.

Possible later invalidation designs, each requiring testing/provider review:

- Delete the exact object and all accessible versions/derived copies when policy
  requires deletion; do not assume a versioned delete marker revokes every URL.
- Use a provider-supported deny/revocation control with verified propagation.
- Use an authenticated streaming proxy/gateway that checks current consent on
  each new/range request and can terminate streams, if stronger immediate control
  is required. This changes infrastructure and is not implemented by this draft.

Do not rotate shared credentials or replace object keys as a supposed per-user
revocation guarantee without assessing provider semantics, other users and copies.
After VIDEO_STORAGE withdrawal or owner deletion, schedule object purge under B;
EXPERT_VIDEO_REVIEW withdrawal blocks expert renewal/access and closes its work,
but does not itself erase independently authorized owner storage. Report/claim
sharing withdrawal stops those uses without creating a video-deletion promise.
Choose TTL, enforcement model and in-flight limits before release; fail closed
if the provider cannot meet the approved access model.

## Implementation ownership and scope boundary

C012 changes only documentation. C019 checks existing profile/questionnaire
relations; C020-C022 implement owner profile/answers/preferences after approval;
C023 later implements consent state/policy/version/idempotency/audit and durable
withdrawal handoff; C024 implements UI/errors/recovery. Phuc owns those features.
Huong owns session/auth maintenance, private video URL/storage/deletion and
account privacy operations. Phuc owns assignment/review/matching exclusions with
Huong coordinating withdrawal. Retention workers, backup suppression, legal
policy, staff MFA and stronger URL enforcement are shared later release work,
not silently added deliverables or completed features of C019-C024.

## Future feature errors

| Status | Accepted direction / concrete proposal |
| --- | --- |
| 400 | Accepted validation status; proposed nested paths and policy validation above |
| 401 / 403 | Existing auth meanings; no staff bypass or blanket logout on 401/403 |
| 415 | Reuse JSON mutation policy |
| 409 | Proposed VERSION_CONFLICT for stale consent expectedVersion |
| 409 | RESOURCE_REVISION_CONFLICT for stale profile/preferences/questionnaire expectedRevision; questionnaireVersion is unrelated |
| 429 | Proposed feature limits and Retry-After; no automatic retry |
| 503 | Dependency failures; proposed DATA_SHAPE_UNAVAILABLE for incompatible legacy JSON |

No current auth code is changed. D1/D2/D4/D11 still require exact-format/value
approval. A transport outage does not prove the write did not commit. Missing
resource GET follows accepted defaults, not 404/provisioning.

## Exact remaining questions for Huong

1. D1/D2/D11: Review resource revision storage/legacy initialization and the
   precise safe 503/remediation UI, first-write defaults and empty-mutation rules.
   Separate revisions, stale-write 409 and complete-result validation are now
   accepted technical direction; no silent legacy repair or auth change.
2. D4: Approve the dedicated withdrawal 60/member/minute and 600/socket-IP/minute
   reserve, exclusion from general quotas, separate mixed-batch submissions,
   gateway reservation, guard ordering and bounded counter behavior?
3. D5/D8: Approve the additional proposed MVP matching eligibility ceiling of
   120 and legacy timestamp/range remediation? Conditional date/age rules and
   selected age bounds do not approve that new eligibility ceiling implicitly.
4. A/D6-D8: Approve every exact catalog ID/label, max-7/max-1/max-3 list cap,
   goal compatibility rule, lexicographic/Jaccard priority interpretation and
   null-default order? Approve profile-catalog-v1 evolution/provenance rules?
5. A/D7: Approve the three full question prompts/keys and Unicode-code-point
   measurement, retired-version selector/status/retention and concurrent-edit
   behavior? Version 1/atomicity/order/length direction is already conditional.
6. D9/D11: Approve grant/revoke registry details, retained timestamps, event
   vocabulary, Idempotency-Key format/fingerprint/replay, 24-hour result retention
   and the later revision/event/outbox schema? Confirm policy snapshot format,
   digest canonicalization and access roles; append-only/verifiable evidence is
   accepted technical direction, not an approved retention/legal policy.
7. B: Approve all candidate retention/deletion periods, triggers and category
   ownership, backup suppression, identity mapping erasure/audit purge, legal exceptions and
   member notices? Which privacy/legal approval governs them? No period is
   represented as legally mandated or production-approved.
8. B/D10: Approve cleanup retries (1m/5m/30m/2h/6h then every 6h), escalation and
   verification targets, retained-report scope and deletion failure reporting?
9. C/D10: Approve 60-second playback URL TTL, exact provider/cache/range semantics
   and outstanding-capability risk, or require a stronger proxy/revocation model?
   Who verifies storage versions, propagation and in-flight races before release?

C012 remains DRAFT / PENDING HUONG REVIEW until outstanding approvals are recorded.
This review direction and these proposals do not implement or complete C019-C024.
