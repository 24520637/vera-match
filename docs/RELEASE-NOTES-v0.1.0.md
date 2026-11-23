# VERA Match v0.1.0 release notes

**Draft for Hương and Phúc’s cross-review. Internal demonstration only, using synthetic adults and synthetic recordings.**

## Included functionality

- Email registration, verification and resend, sign-in and session restoration, sign-out, and password recovery.
- Member profiles, questionnaire and preferences, and five independent, versioned consent purposes with an off default.
- Private video capture/upload, owner playback and deletion, and scoped, short-lived reviewer playback. Eligible experts receive assignments and save timestamped observations in a versioned draft.
- Submission, independent moderator QA, revision and resubmission, owner-only approved reports, claim disputes, and explicit owner confirmation, sharing and revocation of individual factual claims.
- Reciprocal recommendations, limited matching reasons, accept/decline, mutual status and decision history, bilateral blocks and member safety reports. Matching can remain profile-only when report-derived reasons are suppressed.

Reports describe observable evidence and its context. The demo makes no claims about personality, honesty, relationship outcomes, or identity verification. Chat, payments, and automatic video inference are outside v0.1.0 scope.

Matching ranks within each discovery window using that member’s settings. Shared factual claims can appear as reasons and carry zero scoring weight. Reopening an invalidated pair requires a product decision. Production needs a securely provisioned matching handle key, and key rotation invalidates outstanding references. [Matching design](MATCHING-DESIGN.md).

## Demo and QA evidence

T20 ran the joined demo twice on integrated `develop` at `07e0d23`. Each run passed both Chromium projects, exited 0 and left zero fixture schemas, buckets and messages after manual Windows process cleanup. A follow-up run with the T20 worktree fix passed both projects and exited 0 after automatically stopping its two owned server processes. Synthetic staff accounts use assignment-scoped grants and test-only staff assurance, training evidence and policies. A fresh-developer run of the updated README remains pending. [T20 demo results](T20-C102-RESULTS.md) · [T20 demo runbook](T20-DEMO-RUNBOOK.md)

GitHub Actions push run `45108417225` passed on the exact integrated SHA `07e0d23`, including 23 migrations, a synthetic PostgreSQL backup and restore, and disposable HTTPS/proxy checks. The dedicated T20 database also passed local migration and SQL verification. The Windows teardown fix still requires CI on the PR revision. Release sign-off and deployed HTTPS/proxy and recovery verification remain open. The T18 record preserves the historical test runs and internal-demo review. [T20 release evidence](T20-RELEASE-EVIDENCE.md) · [Integrated CI run](https://github.com/24520637/vera-match/actions/runs/45108417225) · [T18 verification record](T18-VERIFICATION.md)

## Release blockers and limitations

| Area | Required before public or real-user use |
| --- | --- |
| Staff eligibility, access and QA | Provision trusted staff identities and session-bound MFA, approved training/confidentiality evidence, and assignment-scoped grants and revocation. Missing production providers fail closed. The PA2 grant/revoke workflow currently uses an internal service. |
| Consent, retention and disclosure | Publish approved versions of each consent notice, settle permitted field and claim disclosure, and approve retention, deletion deadlines and responsibility for reconciliation. Test-only policy evidence has fixture scope. |
| Private media | Validate the deployed storage ACL, TLS and signed-capability range, expiry and in-flight behavior. Withdrawal prevents new authorized access. Previously issued links can remain usable until expiry, and already downloaded bytes cannot be recalled. |
| HTTPS and proxy | Verify Secure cookies, exact allowed origin, trusted proxy boundary and real-client attribution on the deployed path. Current per-process limits reset on restart. A shared proxy address can concentrate limits, and multi-instance protection needs a reviewed shared mechanism. |
| Account lifecycle | The integrated tree contains the lifecycle proposal. The closure foundation and UI remain in draft PRs #35 and #36. Domain minimization and reconciliation receipts are outstanding. Final erasure and production activation require policy and recovery approval. |
| Operations | Verify production TLS SMTP and delivery, private object storage, secret and key rotation, monitoring and on-call ownership. T17 still needs C093 migration/recovery sign-off, C094 privacy and permission sign-off, and C095 runbook review. Synthetic backup and restore evidence exists, and production restores still require an independent restriction journal, replay and cutover fence to prevent reintroducing old access. Confirm deployed backup encryption, access controls, recovery and measured objectives. |

See [Deployment](DEPLOYMENT.md), [HTTPS regression](C084-HTTPS-REGRESSION.md), [Operations runbook](C095-OPERATIONS-RUNBOOK.md), [Consent contract](PROFILE-CONSENT-CONTRACT.md), and [Account lifecycle proposal](C065-ACCOUNT-LIFECYCLE-CONTRACT.md).

## Hương’s review

- Confirm release wording and evidence for authentication and recovery, HTTPS/proxy, private storage and outstanding T17 gates.
- Cross-review consent and disclosure boundaries, closure/erasure status, and the handoff for reviewer, claims and matching lifecycle reconciliation. PRs #32–#34 remain open. Draft PR #37 supplies a restore negative control for the closure stack. Confirm C099 regression evidence on the release PR, C100 access and retention sign-off, and C101 changelog and backmerge reconciliation.
- Confirm operational ownership, the recovery fence, and which checks must rerun on the final joined candidate before approving the notes.

[C054 workflow races](https://github.com/24520637/vera-match/pull/32) · [C062 block integration](https://github.com/24520637/vera-match/pull/33) · [Lifecycle decisions](https://github.com/24520637/vera-match/pull/34) · [Closure foundation](https://github.com/24520637/vera-match/pull/35) · [Closure UI](https://github.com/24520637/vera-match/pull/36) · [Restore negative control](https://github.com/24520637/vera-match/pull/37)
