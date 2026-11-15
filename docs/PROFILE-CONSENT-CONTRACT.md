# C012 draft — Profile, Questionnaire, Preferences and Consent

**PROPOSED / PENDING REVIEW by Huong. C012 is not DONE or FROZEN.**

This is documentation for T02/C012 and future T04/C019-C024, not implemented
DTO classes, routes or migrations. Auth behavior remains as documented in
[API-CONTRACT.md](API-CONTRACT.md). The historical plan at
`5deaf06:docs/COMMIT-PLAN.csv` requires agreement on response envelopes/types
and a completed contract review. Every new shape/semantic choice below is a
proposal until its decision ID is approved; examples are synthetic and do not
establish product vocabulary, numeric limits or legal policy.

## Existing constraints and proposed common rules

Existing scope requires own-member data, three versioned questionnaire answers,
preferences, and five independently controlled consent purposes, all OFF by
default. Existing Prisma models are storage foundations, not validated API DTOs.
See [database mappings and gaps](DATABASE.md).

**PROPOSED (D1-D4):** all routes below live under `/api`, return JSON resource
objects on 200, and use the current cookie session. Success payloads do not
alter auth's flat `AuthUser` or empty 204 responses. DTO notation uses `?` for
omitted request keys and `| null` for an explicitly nullable value; its mutation
semantics are proposed below, with nullable-collection behavior still pending.
Response keys are
present. Non-nullable collections (`answers`, `consents`) are arrays; the proposed
`interests`, `values`, `dealBreakers` and `priorities` types allow `string[] | null`.
The meaning of `null` versus `[]` for these nullable collections is **PENDING
REVIEW (D2/D6/D8)**; examples illustrate possible shapes, not approved semantics.
Instants use ISO-8601 UTC strings; a birth date uses a date-only string (mapping pending D5).
Server owns IDs, timestamps, consent history and policy acceptance evidence.

**PROPOSED validation:** reject unknown/privileged fields, invalid types,
invalid dates, duplicate keys/purposes and oversized collections/text. Do not
silently coerce strings to booleans/numbers or discard invalid array items.
Numeric limits, text lengths and permitted vocabulary remain pending D5-D8;
they must be approved before accepting arbitrary JSON in feature DTOs. PATCH
omission means unchanged. Clearing nullable scalar fields with explicit null is
proposed; nullable-collection null/empty-array behavior remains pending review.
Arrays replace the field as a unit, never implicitly append. Reject empty
mutations rather than writing audit/update timestamps with no requested change.
These are proposed feature rules, not claims about existing auth validators.

| Route | Proposed request | Proposed 200 response |
| --- | --- | --- |
| GET `/profile/me` | No body | `{profile: ProfileReadDto \| null}` |
| PATCH `/profile/me` | `ProfilePatchDto` | `{profile: ProfileReadDto}` |
| GET `/questionnaire/me` | No body | `QuestionnaireReadDto` for the current supported version |
| PUT `/questionnaire/me` | `QuestionnairePutDto` | Saved `QuestionnaireReadDto` |
| GET `/preferences/me` | No body | `{preferences: PreferencesReadDto \| null}` |
| PATCH `/preferences/me` | `PreferencesPatchDto` | `{preferences: PreferencesReadDto}` |
| GET `/consents/me` | No body | `{consents: ConsentStateDto[]}` containing exactly five purposes |
| PATCH `/consents/me` | `ConsentPatchDto` | `{consents: ConsentStateDto[]}` after atomic mutation |

GET returns 200 with null/empty/off defaults for data not yet created, without
creating records or implying consent. First profile/preferences PATCH proposes
an upsert with unchanged nullable fields initially null and visibility false;
GET must not expose another member's data. This lazy-creation/default behavior
is pending D2, not a requirement inferred from nullable schema columns.

## Ownership, session and mutation authorization

Existing auth exports `SessionAuthGuard`, `RolesGuard` and server-side
`CurrentUser`. **PROPOSED (D3):** compose them with explicit MEMBER roles and
resource ownership for all four resources. Derive userId from current context,
never from a body/query/URL override. Reject `userId`, role, email, account
status, verification flags and server timestamps in feature mutations. Do not
grant staff cross-member access through `/me`; any such workflow needs separate
scope and review. Require an active, verified session on every request.

**PROPOSED (D4):** cookie-authenticated PATCH/PUT require the configured exact
Origin and JSON, as auth POSTs do. Reuse the security policy, not blindly
`AuthRequestGuard`: it combines auth-action naming and auth-specific limiter
buckets. Agree feature throttling/guard composition with Huong before code.
Do not disable Origin checks, trust proxy headers, create a second session
provider/client, or add tokens to browser storage. Server authorization must
precede fetching private data; client presentation is not an access boundary.

## Nullable JSON storage mapping — PENDING REVIEW (D2/D6/D8)

The four nullable collection fields are stored in Prisma `Json?` columns.
Database NULL and a stored JSON null are distinct storage values and may have
different domain meanings. This draft does not decide whether either maps to
API `null`, whether they are normalized together, or what an explicit PATCH
`null` or `[]` should persist. Approve the read/write mapping and treatment of
existing rows with Huong before implementation. No conversion, defaulting or
migration rule is implied by the DTO notation or synthetic examples. See
[database review gaps](DATABASE.md).

## Profile DTOs — PROPOSED (D2, D5, D6)

```ts
type ProfilePatchDto = {
  birthDate?: string | null; // proposed YYYY-MM-DD, owner-only
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

String-array interests/values narrow existing unconstrained Prisma JSON; this
is a proposed API shape, not established vocabulary. Text trimming, blank-text
handling, lengths, list deduplication/case handling and allowed goal values
need D6 approval. Proposed validation rejects malformed/future birth dates;
the exact adult boundary, time-zone calculation, requiredness and exposure of
date versus derived age require D5 approval. Never describe declaredAdult as
verified age. `visibilityEnabled` is non-null, explicitly set by the owner,
defaults false and does not grant any consent or bypass matching consent.

`displayName` belongs to `User`/`AuthUser`, not `Profile`. This draft excludes
it from profile writes pending D6; do not silently update it or create a second
display-name field. Any approved mutation later must define auth-context refresh.

Synthetic PATCH and response excerpt (proposed field values, not vocabulary):

```json
{
  "occupation": "Synthetic occupation",
  "bio": "Synthetic profile text for contract review.",
  "interests": ["sample-interest"],
  "visibilityEnabled": false
}
```

```json
{
  "profile": {
    "birthDate": null,
    "occupation": "Synthetic occupation",
    "city": null,
    "bio": "Synthetic profile text for contract review.",
    "relationshipGoal": null,
    "interests": ["sample-interest"],
    "values": null,
    "visibilityEnabled": false,
    "updatedAt": "2026-11-15T00:00:00.000Z"
  }
}
```

## Questionnaire DTOs — PROPOSED (D7)

```ts
type QuestionnairePutDto = {
  questionnaireVersion: number;
  answers: { questionKey: string; responseText: string }[];
};
type QuestionnaireReadDto = {
  questionnaireVersion: number;
  answers: { questionKey: string; responseText: string; updatedAt: string }[];
};
```

The plan requires three versioned answers; the actual keys/prompts, supported
version and answer lengths are not defined. Proposed PUT submits all three
distinct keys for one supported positive-integer version, validates all answers
and writes atomically. Reject partial sets, duplicates, unknown keys/versions,
blank answers and mixed versions. Omission is not deletion; draft/partial-save
behavior would need an explicit alternative contract. Proposed GET before any
save returns that version with `answers: []`; reads do not fabricate answers.
Return stable catalog order, round-trip the approved normalized text, and retain
other versions rather than overwriting them. Version retirement/conflict status
and concurrency still require D7/D11.

Illustrative PUT only: the following placeholder keys/version are **not** an
approved questionnaire and must not be seeded as product data.

```json
{
  "questionnaireVersion": 1,
  "answers": [
    { "questionKey": "PENDING_KEY_1", "responseText": "Synthetic answer one." },
    { "questionKey": "PENDING_KEY_2", "responseText": "Synthetic answer two." },
    { "questionKey": "PENDING_KEY_3", "responseText": "Synthetic answer three." }
  ]
}
```

Proposed response has the same version/answer texts and a server `updatedAt`
for each answer; it never returns another user's answers or internal user IDs.

## Preferences DTOs — PROPOSED (D8)

```ts
type PreferencesPatchDto = {
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

The arrays are provisional identifiers, not unrestricted JSON, arbitrary
executable filters or approved matching weights. Confirm their catalog,
ordering/weight semantics and limits with Huong/product ownership. Proposed
age validation accepts only integers in an approved adult range and requires
minAge <= maxAge when both exist. Evaluate the merged persisted + PATCH values,
not just submitted fields; reject the whole request on an invalid combination.
Meaning of one-sided/null ranges and goal compatibility remains pending D8.

Synthetic PATCH example (the ages are examples, not proposed global limits):

```json
{ "minAge": 25, "maxAge": 40, "dealBreakers": [], "priorities": null }
```

The proposed response wraps the complete merged values in `preferences`, with
`relationshipGoal: null` if unset and a server `updatedAt`. Saving preferences
does not activate profile visibility or matching consent.

## Consent DTOs and audit — PROPOSED (D9-D11)

These five purpose identifiers already exist in Prisma:

```ts
type ConsentPurpose =
  | "PROFILE_MATCHING" | "VIDEO_STORAGE" | "EXPERT_VIDEO_REVIEW"
  | "REPORT_SHARING" | "VIDEO_CLAIM_MATCHING";
type ConsentPatchDto = {
  consents: {
    purpose: ConsentPurpose;
    granted: boolean;
    policyVersion?: string; // proposed required on grant; revoke must remain possible
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
```

`policyVersion` in these DTOs is a **schema gap**, not an existing persisted
field. Server must verify approved policy identifiers, not accept arbitrary
strings as evidence. Policy text/version ownership, re-consent, event storage,
idempotency and withdrawal behavior require Huong's review before implementation.

Proposed GET always returns all five states in enum order. A missing DB row
projects `granted:false` with all timestamps/policyVersion null, without writing
records. PATCH contains a nonempty set of distinct purposes; omission leaves
others unchanged. `granted` must be a JSON boolean, never null/string. Validate
the entire request and atomically persist changes plus audit events; server
assigns actor, user, purpose, effective time, old/new state and applicable policy
evidence. Never trust client timestamps/actor IDs or log tokens/raw private text.

Synthetic grant/revoke examples, both **PENDING REVIEW**:

```json
{
  "consents": [
    { "purpose": "PROFILE_MATCHING", "granted": true, "policyVersion": "PENDING_POLICY_VERSION" }
  ]
}
```

```json
{ "consents": [{ "purpose": "EXPERT_VIDEO_REVIEW", "granted": false }] }
```

The placeholder policy is not a valid accepted policy. A full proposed response
contains five `ConsentStateDto` objects. One response item after revocation:

```json
{
  "purpose": "EXPERT_VIDEO_REVIEW",
  "granted": false,
  "grantedAt": "2026-11-14T00:00:00.000Z",
  "revokedAt": "2026-11-15T00:00:00.000Z",
  "policyVersion": "PENDING_POLICY_VERSION",
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

Whether current state retains the previous accepted policy/grant timestamp,
as illustrated, must be decided in D9; historical evidence must remain in the
approved audit mechanism regardless. Do not infer audit history from these
current-state timestamps alone. Proposed repeated no-op updates do not create
duplicate transition events; decide separate request-attempt auditing explicitly.

Existing privacy requirements demand current-consent checks and timely loss of
dependent access. Proposed withdrawal updates the authoritative consent before
success is acknowledged; media/review/matching must deny newly unauthorized
access even if asynchronous cleanup is pending. Do not promise instantaneous
revocation of already-issued signed URLs without a supported mechanism. No
purpose auto-grants another; approval/sharing of individual claims remains a
separate gate. Decide how invalid purpose combinations, retention/deletion,
assignment cancellation and revoked policy versions interact in D9/D10.

## Proposed error and concurrency behavior — PENDING REVIEW (D1, D11)

| Status | Proposed feature meaning |
| --- | --- |
| 400 | DTO validation failure using existing `VALIDATION_FAILED` envelope; agree nested field paths before feature validators |
| 401 / 403 | Reuse session/role status meanings; missing/foreign Origin denied, no automatic logout on 403 |
| 415 | JSON content type required for mutations |
| 409 | Only for an approved stale-write/version/policy conflict design; do not claim locking/version fields currently exist |
| 429 | Agreed feature rate limits, optional Retry-After; no automatic mutation retries |
| 503 | Sanitized transient dependency failure; show retry/revalidation, do not assume persistence or logout |

No feature-specific machine codes beyond existing conventions are finalized.
No 404 for a caller's never-created resource is proposed here; D2 must decide
whether to keep 200 defaults or use an explicit not-created response instead.
Atomic multi-field writes are proposed, but updatedAt alone is not an optimistic
lock. Decide last-write-wins versus version/ETag conflict handling, especially
for simultaneous grant/revoke. Agree safe reconciliation/idempotency before
retries; a transport error does not prove a mutation did not commit.

## Decision register — all PENDING REVIEW

| ID | Exact question for Huong's review |
| --- | --- |
| D1 | Preserve existing auth shapes/statuses and use these resource wrappers for new routes? Use 400 validation, and what nested field-path/error code convention is approved? |
| D2 | Approve GET null/empty/off defaults without writes, lazy profile/preferences creation, PATCH omission/scalar clearing/array replacement, and rejection of empty mutations? What do null versus [] mean for nullable collections, and how should API null map to database NULL versus JSON null on reads/writes and existing rows? |
| D3 | Restrict these `/me` routes to active verified MEMBER accounts with server-derived ownership, including denial to staff roles without separate scope? |
| D4 | Which shared Origin/JSON guard composition and feature rate limits should protect PATCH/PUT without reusing auth-specific action buckets? |
| D5 | Is birthDate optional, what adult/date/time-zone rule applies, and does owner response include date-only birthDate or another projection? |
| D6 | Approve field lengths, goal/interest/value catalogs, array and text normalization, visibility/consent separation, and exclusion of User.displayName from profile writes? If name editing is needed, how does auth refresh? |
| D7 | What are the three canonical question keys/prompts, initial version and answer limits; approve whole-version atomic PUT, empty GET and version retention/retirement behavior? |
| D8 | What adult age bounds, null/one-sided-range meanings, goal catalog and dealBreakers/priorities shapes/order/limits are approved? |
| D9 | Who owns policy text/version identifiers; require current policy on grant but allow withdrawal without it? What state/history is retained, where are audit events stored, and how are no-op requests handled? |
| D10 | How must withdrawals affect video storage/review, signed access, assignments, claims/matching and retention/deletion; which synchronous guarantees can API success promise? |
| D11 | Which stale-write/idempotency strategy prevents unsafe concurrent consent changes and defines 409 versus validation behavior? |

Huong reviews shared auth/privacy boundaries; Phuc owns feature DTO design.
Product vocabulary, consent wording and retention choices may need additional
product/privacy approval. No approval is inferred from this draft. Record
reviewer, decision/date and reference for each item; any unresolved item remains
PROPOSED / PENDING REVIEW. Only an actual completed contract review can satisfy
C012's verification; it does not mark C019-C024 implemented.
