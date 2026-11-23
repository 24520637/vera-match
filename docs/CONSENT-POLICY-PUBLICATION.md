# Versioned consent publication

Huong owns the product/engineering integration. The candidate notice version is 2026-11-23.v1, with the exact English/Vietnamese text from the previously recorded C1 notices. This implementation does not approve a legal basis, create a production approval or publish a policy to real users.

## Runtime contract

All five purposes remain independent, optional and OFF by default. Candidate text is compiled in consent-policy.catalog.ts; it is not returned by the ordinary registry without approval. Existing purpose/generation/CAS/withdrawal semantics are preserved.

An operator may configure both CONSENT_POLICY_MANIFEST_PATH and CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH as absolute, read-only file paths outside the repository after actual authorized approval. The first file contains a signed envelope; the second contains the approved authority's Ed25519 public key. The application has no signing key, approval-creation endpoint, publication boolean or testOnly policy switch. Missing both files keeps publication unavailable. Partial, malformed, invalid, expired or untrusted configuration fails startup with code-only diagnostics.

Envelope shape: payload plus base64url signature. The payload has schemaVersion 1, publicationId, approvedByReference, legalBasisReference, approvedAt, expiresAt and policies. Each policy contains purpose, policyVersion, locale, exact content and its SHA-256 UTF-8 digest. Publication may cover a subset of purposes, but every published purpose needs both en and vi notices. The version/content/digest must match the compiled candidate; duplicates, extra approval fields and unknown purposes/locales are rejected. The approval lifetime is bounded to 366 days and may be shorter. The trusted key authority and legal approval must be established outside this code; a valid signature does not by itself certify compliance.

Signatures cover the UTF-8 bytes of VERA-MATCH:CONSENT-POLICY-APPROVAL:v1 followed by a newline and canonicalPolicyPayload(payload). Object keys are recursively sorted, arrays keep their approved order, and strings are not normalized or reworded. Do not sign ordinary JSON.stringify output or reuse MFA/recovery encryption keys as approval keys. Preserve the reviewed envelope and authority evidence in approved restricted operational storage; this PR does not install that archive.

Registry snapshots load once at startup and remain immutable. Expiry is checked on each use. This supports the current single-API-process deployment only: stop the old process before replacing a publication or rotating authority files, validate the new reviewed artifact, then restart. Do not hot-edit files, run an overlapping old-policy process or roll back to a stale publication. Multi-instance coordinated activation is not claimed.

## Member API and UI

GET /api/consents/policies?locale=en or vi requires an active verified MEMBER session. It returns only current approved content, version, locale, digest, optional=true and actual feature dependencies. It returns no signing key, signature, private approval metadata or member data. Missing publication returns an empty policy list. Other query fields/locales are rejected. Metadata is private/no-store and uses the existing read quota.

A real grant through PATCH /api/consents/me supplies purpose, granted=true, policyVersion, locale and policyDigest, with the existing expectedVersion and Idempotency-Key. The server chooses the authoritative approved snapshot and checks the exact displayed binding. Locale/digest enter new idempotency fingerprints; legacy requests without those fields retain their previous fingerprint format. Only existing synthetic testOnly fixtures in NODE_ENV=test retain the old fixture contract; the real registry never returns testOnly snapshots.

Withdrawal needs neither a current policy nor a locale/digest. No unrelated grant is added. Existing immutable ConsentPolicyEvidence preserves the exact locale/content/digest; a new displayed locale requires an explicit new grant and records POLICY_RECONSENT. A new policy version needs explicit re-consent. Older recorded grants do not authorize processing if their approved current snapshot is absent, expired or different. Historical evidence is not rewritten or silently set OFF.

The member screen loads approved notices through the same existing client and computes the content hash before enabling a grant. Language changes clear unchecked/accepted state. Each grant is explicit and binds the current text; uncertain operations keep their original key and cannot be silently resubmitted in another language. Failure to load notices disables grants while keeping withdrawal available. Text is rendered as text with the selected language attribute; no HTML interpretation, browser secret storage or new theme is introduced. Shared mist/plum controls and typography remain unchanged.

Re-consent never removes prior withdrawal tasks, restores old assignment bindings or revives matching handles/claims. All consumers continue through the authoritative ConsentAccessService and existing generation checks.

## Verification and release gates

Synthetic tests create ephemeral signing keys solely inside disposable test processes. No production private key, signed approval artifact or real user data is committed. Unit coverage verifies signatures, domain separation, content/locale/digest, lifetime, missing/partial configuration and historical idempotency. PostgreSQL/HTTP tests use actual login, sessions, guards, immutable evidence and generation checks. The dedicated browser runner creates a fresh disposable schema and ephemeral signed test authority, runs real desktop/mobile grant/withdraw flows and deletes only its owned public-key/manifest files. Corrupt-response UI tests intentionally alter delivered metadata to prove the client refuses grants while real withdrawal still works.

Production publication remains BLOCKED until an authorized owner approves the exact copy and applicable legal/privacy basis, establishes approval-key custody and retention/support conditions, and an operator installs the approved files. No test signature counts as that approval. Actual host rollout/key rotation and legal sign-off are NOT RUN here. The separate Swagger #41 → #42 integration must be reviewed before release; this feature adds one documented policy-discovery route and new optional request binding fields that must be reconciled into that final combined schema.

## Preparing material for actual approval

After building the API, npm run consent:policy-candidate exports exact candidate bytes/digests with null approval metadata and a null signature. This unsigned output is deliberately rejected by the runtime. It generates no signing key and has no publish command. An authorized approver must review the exact language/content, legal basis and retention/support conditions; an operator records the actual approval references and dates, signs policyApprovalMessage(payload) with the separately held authority key, and installs only the approved envelope and public key. Never fill approval fields or create production signatures merely to make a test or demo pass.
