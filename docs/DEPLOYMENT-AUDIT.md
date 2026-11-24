# Production preparation audit — 2026-11-24

Candidate: remote develop at 0eabed068c2dd4063f5e4e9358b0642417544aeb plus the reviewed preparation changes on codex/production-preparation. Remote HEAD was rechecked and is unchanged. Work is in the clean vera-match-deploy-audit checkout; the original OneDrive checkout and its uncommitted files were preserved.

Decision: **PREPARATION DELIVERED; REAL-USER PRODUCTION RELEASE NOT APPROVED/DEPLOYED.** The new code covers independent-journal fencing/quarantine and approved closure minimization. Final retention/purge, post-status-window identity minimization, real staff/provider setup and hosted acceptance remain outstanding. No real production database has been migrated and no paid infrastructure has been provisioned.

## Implemented and checked

- Fixed the current develop CI failure: external qualification evidence is loaded without holding mutation row locks. Moderator/session/MFA checks happen before lookup and are repeated under the write locks. Authorization and atomic audit evidence remain enforced.
- Added a separate authenticated, fsynced, hash-chained Ed25519 journal service, replay client, immutable APPLIED/QUARANTINED receipts, ordinary-request/readiness fence and fresh signed availability checks. A single writer and a single API process are required.
- Added explicit immutable database/journal binding. Ordinary startup never initializes a fresh identity. A native backup predating the binding is rejected; an old post-binding backup receives conservative account quarantine and genuine consent OFF events/tasks before listeners open.
- Captured the implemented restriction entry points described in PRODUCTION-RECOVERY-AND-CLOSURE.md. Prepared journal records survive main-database rollback; ambiguous failures close the request fence. Quarantine requires support review and does not manufacture closure/staff/erasure history.
- Added signed closure-minimization authorization, a worker that honors unresolved report/dispute holds, member-data/draft minimization, pair invalidation and four immutable domain receipts. A database trigger refuses non-media ACKs without receipts. Only all-five-consumer acknowledgement advances to RETENTION_PENDING; no final erasure is claimed.
- Added Node.js/Linux systemd/nginx templates, a new-host journal installer, secret-configuration generator, production preflight, source packaging/checksums and an operator handoff. Production journal installation/initialization is explicit, outside ordinary API startup.
- Added the owner-provided public privacy contact to the app footer: buiquynhhuong2101@gmail.com.

## Executed verification

Environment: Windows, Node.js 26.8.2, native PostgreSQL 18, FFmpeg/FFprobe, temporary native MinIO/Mailpit and disposable synthetic schemas/databases. CI targets Node.js 24/Linux and must still verify the committed candidate.

| Check | Result |
| --- | --- |
| Clean npm ci / original lockfile | PASS; no dependency major upgrade adopted |
| Prisma schema validation/client generation | PASS |
| API and web production build / TypeScript lint | PASS, final sequential build |
| API unit tests | PASS — 42 suites, 487 passed, 4 existing skipped |
| Entire integration run | Executed all 50 suites / 753 tests; initially 48 suites passed and two historical migration fixtures failed because they did not account for new dependent/additive tables |
| Corrected migration fixtures and affected regression groups | PASS — 9 suites / 79 tests, including both former failures; repeated after the binding migration |
| Final recovery/closure receipt tests | PASS — 2 suites, including native pre/post-binding restores and verification after JSONB property reordering |
| Browser interactions/accessibility | PASS — 220 desktop/mobile tests |
| Real browser auth/member/video and disposable HTTPS workflow suites | NOT RUN on the final candidate; presentation tests do not replace these release-candidate gates |
| Release configuration tests | PASS — 10 tests |
| Independent journal protocol/setup tests | PASS — 8 tests |
| Journal installer Bash syntax | PASS; actual host installation NOT RUN |
| Approved consent/minimization signatures | PASS — exact Ed25519 verification; private signing material excluded from deployment archives |
| Production dependency audit high/critical threshold | PASS; 5 moderate affected production packages remain |
| New-host DNS/TLS, SMTP delivery, private storage, staff MFA and hosted smoke | NOT RUN — no real target/provider configuration exists |

The full integration run was followed by focused reruns resolving both failed fixtures; this report does not describe the first full run as wholly green. The final additive database catalog is 29 migrations / 65 foreign keys / 98 non-internal triggers. No shared/developer schema was reset. One build attempt overlapped a UI dev server and lost generated .next types; UI finished successfully, its servers stopped, the verified clone-only build cache was removed, and the final sequential build passed. A tool-session reset stopped the temporary native providers during a focused rerun; they were restarted and that rerun passed. Neither environmental failure remains unresolved.

## Owner approval and key custody

The owner explicitly authorized signing the reviewed EN/VI consent notices and the exact closure-minimization actions in chat, stated personal operation and international/English support, and supplied the privacy contact above. A newly generated operator-held Ed25519 key was used on that delegated instruction; no external legal-identity certification is asserted. The approval record and signed deployment-only files are under the operator's .vera-match-production directory outside Git, with Windows ACLs restricted to the owner and SYSTEM. The signing private key is in operator-only and is not in either deployment archive or the API configuration.

The signed approvals expire on 2027-02-22. This is approval validity, not a data-retention period. Their scope explicitly leaves retained evidence pending a separately approved final retention schedule. Neither signing nor automated checks establish legal compliance in every target country, an individual member's consent, or hosted production approval. The unsigned candidates in docs/production remain review references; nothing is automatically published by keeping them in source.

Protected API-side matching/MFA wrapping-key material and a separate operator staff-authority signing key/public-key ring were also generated outside Git and validated with the actual configuration parsers. No account, signed staff directive, factor enrollment or expert qualification was fabricated. The API-private files and operator private keys are excluded from both deployment archives; only the actual operator installs the necessary API configuration over a protected channel.

## Outstanding before admitting real users

1. Finalize and implement the actual approved retention/purge schedule, holds and post-status-window identity minimization. Current evidence remains restricted/RETENTION_PENDING; the worker does not invent final erasure or a provisional legal retention duration.
2. Provision an application host/database and an independently protected current journal authority, real domain/DNS/TLS, SMTP, private storage, scoped credentials, key custody, monitoring and operator access. A domain purchase alone supplies none of these services.
3. Install approved policy files and actual staff authority/MFA/qualification/grant configuration. Synthetic test staff evidence is never production provisioning.
4. Review/apply the three additive migrations under an approved backup plan; explicitly bind a fresh deployment once. Never initialize a restored database or reinitialize journal history to bypass a closed fence.
5. Rehearse real backup encryption/ACLs, independent journal-host recovery/high-watermark custody, storage history cleanup and measured RPO/RTO. The service assumes its independently trusted authority is not rolled back alongside the app; no multi-region journal durability is claimed.
6. Commit/integrate the reviewed source changes and pass the full Node.js 24/Linux candidate CI, then verify the actual HTTPS site, SMTP, storage, staff flow, proxy/rate-limit topology and monitoring with approved synthetic data before release sign-off.

Artifacts and commands: deploy/UPLOAD-GUIDE.md and docs/PRODUCTION-RECOVERY-AND-CLOSURE.md. This report records the preparation checks. Publishing the reviewed branch does not constitute deployment or production sign-off.
