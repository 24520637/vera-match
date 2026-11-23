# Signed Expert qualification source

Owner authorized implementation on 2026-11-24. This authorizes the integration, not a claim that any named person completed training. No real staff or completion record is seeded.

An independent Ed25519 qualification authority signs `VERA-MATCH:EXPERT-QUALIFICATION:v1` followed by canonical sorted-key JSON. This authority must be separate from member consent approval, staff provisioning and MFA wrapping keys. The manifest binds exact versioned curriculum/confidentiality content and individual evidence IDs, account IDs, purpose, completion content and dates.

Install `EXPERT_QUALIFICATION_MANIFEST_PATH` and `EXPERT_QUALIFICATION_PUBLIC_KEY_PATH` as absolute operator-controlled files outside Git. The signed payload schema is exported as QualificationPublication. A publication lasts at most 24 hours and is read on every lookup; replace by atomic rename. Remove a revoked person's evidence or version in a new signed publication. Missing, malformed, tampered, expired or partially installed publication fails closed. Maintain monotonic operator archival/recovery controls; signed files alone do not solve old-backup rollback.

Existing immutable ExpertCredentialApproval snapshots retain exact content and provenance. Runtime evidence checks compare those snapshots with the current authority source; publication never grants an assignment, MFA proof or self-approval. Existing account, role, assignment, consent-generation and independent QA barriers remain. Production Expert route gates are not removed by this source alone.

Verification: signed-payload unit tests cover signature substitution, tampering, expiry, future issuance/completion, duplicate IDs, missing versions, unsupported fields and domain separation. External evidence import/review and deployment remain operational responsibilities. No legal consent approval is created.
