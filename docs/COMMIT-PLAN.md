# VERA Match — 104 proposed micro-tasks and commits

> **PLANNED, NOT IMPLEMENTED:** 104 proposed meaningful changes. Commit only when real code or documentation has been changed and verified. Huong: 52; Phuc: 52; 20 tickets across 10 working days.

## Working rules

- Keep each entry aligned with its `owner`, `ticket`, `branch`, and specified scope.
- Report each verification honestly as `PASS`, `FAIL`, or `NOT RUN`. Never make empty commits to reach a number.
- Work on release tasks only after cutting a **new release branch from tested `develop` on D9**; do not use a bundle placeholder.
- If dependencies or workload change, update the plan and agree on adjustments with both developers.

## D1

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C001 | T01 | huong/chore/auth-foundation | chore(env): define typed auth and SMTP configuration | Validate env for DB, session TTL, cookie flags, SMTP, MinIO | API refuses missing required secrets |
| C002 | T01 | huong/chore/auth-foundation | feat(db): connect Prisma and graceful shutdown | Wire DB client lifecycle, health checks and disconnect | DB health + graceful stop smoke |
| C003 | T01 | huong/chore/auth-foundation | feat(auth-db): enforce pending email account default | Add initial User/Session/token schema and indexes | Prisma validate + migration test |
| C004 | T01 | huong/chore/auth-foundation | feat(auth): add Argon2id password helper | Implement hash/verify wrapper and work-factor config | Password hash unit tests |
| C005 | T01 | huong/chore/auth-foundation | feat(auth): add session-auth request context | Build server auth context and session guard skeleton | Denied on missing/invalid cookie |
| C006 | T01 | huong/chore/auth-foundation | test(core): add auth and database smoke fixtures | Use synthetic users/test secrets; failure tests | Jest smoke suite passes |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C007 | T02 | phuc/chore/web-foundation | chore(web): organize public and protected route groups | Create app shell with public/member/expert/moderation layouts | Next build & route smoke |
| C008 | T02 | phuc/chore/web-foundation | style(web): add form components and design tokens | Inputs, form errors, focus, mobile spacing | Keyboard + mobile visual smoke |
| C009 | T02 | phuc/chore/web-foundation | feat(web): implement typed same-origin API client | Use /api proxy, typed errors/credentials policy | Client 401/403/500 tests |
| C010 | T02 | phuc/chore/web-foundation | feat(web): add auth loading boundary | Pending session state, no protected flash | Protected route initial loading test |
| C011 | T02 | phuc/chore/web-foundation | ci(core): validate API web schema on PR | Remove AI CI; add API/Web build, Jest, prisma validate | CI YAML lint and workflow run |
| C012 | T02 | phuc/chore/web-foundation | docs(contract): freeze auth and profile DTO contracts | Agree response envelopes/types with Huong | Contract review done |

## D2

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C013 | T03 | huong/feat/email-auth-session | feat(auth): add registration DTO and age declaration | Validate email/password/18+ confirmation | Invalid/underage request rejected |
| C014 | T03 | huong/feat/email-auth-session | feat(auth): persist pending registration only | Create user status pending, hash password, duplicate handling | Cannot login before verify |
| C015 | T03 | huong/feat/email-auth-session | feat(email): generate single-use verification link | Hash token, TTL and Mailpit adapter | Mailpit sees real link; DB stores only hash |
| C016 | T03 | huong/feat/email-auth-session | feat(auth): consume verification token atomically | POST verify-email, mark used and set Active | Token cannot be replayed |
| C017 | T03 | huong/feat/email-auth-session | feat(email): resend verification with cooldown | Generic response, replace old token, limit rate | Cooldown and unknown email tests |
| C018 | T03 | huong/feat/email-auth-session | feat(auth): issue secure login session cookie | Credential check, generate random session hash, cookie | Login works only after verified; cookie flags |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C019 | T04 | phuc/feat/profile-consent | feat(profile-db): create versioned questionnaire relations | Profile, Preference, Questionnaire schemas and indexes | Prisma validate/migrate |
| C020 | T04 | phuc/feat/profile-consent | feat(profile-api): implement own-profile read update | Validate occupation/goals/values/interests | Other user cannot read/write |
| C021 | T04 | phuc/feat/profile-consent | feat(questionnaire-api): store three versioned answers | Create DTO/persistence and owner guard | Save and reload returns identical answers |
| C022 | T04 | phuc/feat/profile-consent | feat(preferences): implement age/dealbreaker settings | Validate age min/max and goal filters | Invalid range denied |
| C023 | T04 | phuc/feat/profile-consent | feat(consent-api): default all five purposes off | Grant/revoke event history with policyVersion | Fresh account false, audit event written |
| C024 | T04 | phuc/feat/profile-consent | feat(profile-ui): deliver profile questionnaire consent screens | Form states, save/reload, independent consent controls | E2E save + refresh + revoke |

## D3

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C025 | T05 | huong/feat/email-auth-session | feat(auth): add current-session lookup endpoint | GET /auth/me from cookie/DB with safe user projection | 401 invalid; 200 safe fields |
| C026 | T05 | huong/feat/email-auth-session | feat(web-auth): restore session on refresh | Auth provider loads me; handles pending/unknown states | F5 remains logged in |
| C027 | T05 | huong/feat/email-auth-session | feat(web-auth): add login redirect and remember-email opt-in | Safe next path; email-only local remember when checked | No password/token in storage |
| C028 | T05 | huong/feat/email-auth-session | feat(auth): implement logout and logout-all | Revoke Session hash, clear cookie for same Path | All sessions fail after logout-all |
| C029 | T05 | huong/feat/email-auth-session | feat(auth-ui): add login register verify and expired states | Frontend forms use actual backend, resend links | Browser register→verify→login complete |
| C030 | T05 | huong/feat/email-auth-session | test(auth): cover account status session revoke and outage | Pending/suspended/expired/500 distinguish | 401 redirects, 500 retries |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C031 | T06 | phuc/feat/expert-assignment | feat(expert-db): add credentials and assignments | Create ExpertCredential/ExpertAssignment transitions | Migration & FK tests |
| C032 | T06 | phuc/feat/expert-assignment | feat(expert-admin): approve eligible expert records | Moderator can verify confidentiality/training | Member role cannot self-approve |
| C033 | T06 | phuc/feat/expert-assignment | feat(assignment-api): assign READY video with consent | Validate expert eligibility, conflicts, video state | No consent or unverified expert denied |
| C034 | T06 | phuc/feat/expert-assignment | feat(expert-guard): restrict assigned video reads | Assignment-bound role guard and TTL access | Expert cannot access other video |
| C035 | T06 | phuc/feat/expert-assignment | feat(expert-ui): build assignment and moderation queues | Own queue, status, dueAt, assign/cancel confirmation | Reviewer sees only their jobs |
| C036 | T06 | phuc/feat/expert-assignment | test(expert-assign): test cancel and reassignment races | Transitions, version and audit tests | Canceled assignment access rejected |

## D4

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C037 | T07 | huong/feat/private-video | feat(media): add private object storage client | MinIO typed adapter, opaque generated object keys | No public ACL; config test |
| C038 | T07 | huong/feat/private-video | feat(media): issue owner-scoped upload URL | Check consent/size/MIME, generate short URL | Anonymous and cross-owner rejected |
| C039 | T07 | huong/feat/private-video | feat(media): confirm upload against actual object | HEAD/check MIME and bytes, status READY | Spoofed/large file denied |
| C040 | T07 | huong/feat/private-video | feat(media-ui): add camera and file upload progress | Record/upload/preview with unsupported-device fallback | Mobile file input/desktop works |
| C041 | T07 | huong/feat/private-video | feat(media): add owner playback and metadata list | Signed GET only for authorized owner | No objectKey exposed to wrong user |
| C042 | T07 | huong/feat/private-video | test(media): cover IDOR oversized and invalid uploads | Unit/integration tests for owner consent and TTL | Unauthorized requests return 403/404 |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C043 | T08 | phuc/feat/expert-review-workspace | feat(review-db): create review draft and observation entities | Review status/version and evidence timestamps | Prisma migration + validation |
| C044 | T08 | phuc/feat/expert-review-workspace | feat(review-ui): build expert video player with timeline | Assigned-video playback with time markers | Unassigned video inaccessible |
| C045 | T08 | phuc/feat/expert-review-workspace | feat(review): add five observation categories | EYE/FACIAL/BODY/SPEECH/CROSS_MODAL structured notes | Each category saves safely |
| C046 | T08 | phuc/feat/expert-review-workspace | feat(review): validate timestamp range and context | start/end within duration; explicit observation | Invalid timecode returns 422 |
| C047 | T08 | phuc/feat/expert-review-workspace | feat(review): add draft autosave with optimistic version | PATCH draft, reject concurrent stale writes | 409 version conflict test |
| C048 | T08 | phuc/feat/expert-review-workspace | test(review): verify reviewer isolation and draft persistence | Assigned owner only, no public drafts | Draft survives reload no leaks |

## D5

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C049 | T09 | huong/feat/private-video | feat(media): implement delete and signed-access revocation | Remove object and mark video removed | Deleted video cannot issue new playback URL |
| C050 | T09 | huong/feat/private-video | feat(consent): stop expert work after revocation | Check active consent at every media/review read | Revoke prevents new API access |
| C051 | T09 | huong/feat/private-video | feat(media): cancel assignments for removed video | Safely transition active assignments canceled | Canceled experts denied video |
| C052 | T09 | huong/feat/private-video | feat(media-ui): display cancel and consent loss states | Progress/failed/canceled/error messages | UI does not show stale successful upload |
| C053 | T09 | huong/feat/private-video | feat(audit): log privacy actions without media payloads | Audit revoke/delete/denied assignment metadata | Audit excludes token and video content |
| C054 | T09 | huong/feat/private-video | test(media-privacy): cover revoke during review | Race test revoke and signed playback | New URL denied, object cleanup verified |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C055 | T10 | phuc/feat/review-approval | feat(review): require summary limitations before submit | Validate observations, transcript optional, limitation | Incomplete review cannot submit |
| C056 | T10 | phuc/feat/review-approval | feat(review): submit locks review version for QA | Transition DRAFT→SUBMITTED with audit | Concurrent duplicate submit idempotent |
| C057 | T10 | phuc/feat/review-approval | feat(review-qa): implement return with actionable reasons | Moderator returns to expert, increments version | Expert can edit returned only |
| C058 | T10 | phuc/feat/review-approval | feat(review-qa): implement QA approval separate from author | QA guard, state check and approval audit | Self-QA denied |
| C059 | T10 | phuc/feat/review-approval | feat(review-owner): expose only QA-approved report | Member report page with source and limitations | Draft not accessible to owner |
| C060 | T10 | phuc/feat/review-approval | test(review-qa): cover publish and state transitions | Invalid transitions / version conflicts denied | Correct state matrix tests green |

## D6

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C061 | T11 | huong/feat/safety-privacy | feat(safety-db): add block report and audit relations | Block/Report enums/indexes and moderation action data | Migration / uniqueness checks |
| C062 | T11 | huong/feat/safety-privacy | feat(safety): block users with immediate match exclusion | Create/delete own block; guard match/review access | Both directions excluded after block |
| C063 | T11 | huong/feat/safety-privacy | feat(safety): accept bounded report submissions | Reason/details validation and safe target handling | Cannot report invalid identity via IDOR |
| C064 | T11 | huong/feat/safety-privacy | feat(moderation): build reports queue and status changes | Moderator role only, no full video content leak | Member cannot access queue |
| C065 | T11 | huong/feat/safety-privacy | feat(privacy): revoke account and schedule data cleanup | Deactivate account, revoke sessions and plan private object removal | Deleted account cannot request new video URLs |
| C066 | T11 | huong/feat/safety-privacy | feat(safety-ui): build block report and deletion screens | Confirm destructive actions and error/empty states | UI works against real services; safety tests at D8 |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C067 | T12 | phuc/feat/review-approval | feat(review-claim): create factual review claims | Store category/source timestamp and owner link | Claims not shareable by default |
| C068 | T12 | phuc/feat/review-approval | feat(review-owner): add transcript context feedback screen | Owner can annotate and submit feedback | Other account cannot post |
| C069 | T12 | phuc/feat/review-approval | feat(review-dispute): submit and resolve disagreements | Open/resolution status audit and versioning | Disputed report cannot silently change |
| C070 | T12 | phuc/feat/review-approval | feat(review-claim-ui): confirm claims individually | Owner checks each statement; no bulk default opt-in | No claim shared without explicit action |
| C071 | T12 | phuc/feat/review-approval | feat(review-claim): revoke confirmed claim immediately | Revoke timestamp and privacy gate | Ranking excludes revoked data |
| C072 | T12 | phuc/feat/review-approval | test(review-owner): verify claim ownership and QA gate | Cross-user/QA draft/revoke tests | All 403/404 cases covered |

## D7

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C073 | T13 | huong/feat/auth-recovery-security | feat(auth-recovery): generate password reset mail | Generic response, random hashed TTL token | No user enumeration; Mailpit receives link |
| C074 | T13 | huong/feat/auth-recovery-security | feat(auth-recovery): consume reset and revoke sessions | Atomic password rehash + token use + logout-all | Old session cannot call /me |
| C075 | T13 | huong/feat/auth-recovery-security | feat(auth-ui): build forgot and reset password pages | Validation/expired/used token UX | Browser reset/login new password works |
| C076 | T13 | huong/feat/auth-recovery-security | feat(auth-security): add rate limits and CSRF controls | Origin check, CSRF scheme for cookie mutations | Foreign origin POST denied |
| C077 | T13 | huong/feat/auth-recovery-security | test(auth-recovery): test replay and multi-device logout | Replay/cooldown/lockout session test | Old reset link unusable, old sessions revoked |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C078 | T14 | phuc/feat/reciprocal-matching | feat(match): implement two-sided hard-constraint filters | Age goal consent visibility block and self exclusions | Tests both directions and edge cases |
| C079 | T14 | phuc/feat/reciprocal-matching | feat(match): add directional score and explanation labels | Heuristic weighted profile goals/values/lifestyle/interests | Score not presented as probability of love |
| C080 | T14 | phuc/feat/reciprocal-matching | feat(match): integrate owner-confirmed QA claims only | Require both share and video-content matching consent | Revoked/unknown review never ranked |
| C081 | T14 | phuc/feat/reciprocal-matching | feat(match-decisions): add atomic accept decline and mutual state | Transaction and idempotent decisions | Concurrent accepts yield one mutual match |
| C082 | T14 | phuc/feat/reciprocal-matching | feat(match-ui): build recommendations and decision history | Cards, reasons, accept/decline, empty and error | E2E match and reload shows persistence |

## D8

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C083 | T15 | huong/test/security-regression | test(auth-security): reject IDOR and session fixation | Cross-user profile/video IDs and rotated tokens | Negative auth matrix passes |
| C084 | T15 | huong/test/security-regression | test(cookie): verify flags redirect and offline restore | HTTP local vs HTTPS cookie paths, 401/403/500 | Cookie/security E2E checks pass |
| C085 | T15 | huong/test/security-regression | test(media): verify signed URL owner and assignment TTL | Replay-after-delete and revoked consent paths | No signed private URL leaks |
| C086 | T15 | huong/test/security-regression | test(expert-access): harden staff role and assignment checks | Non-assigned/expert inactive role and MFA gate | Staff real-data access fails closed |
| C087 | T15 | huong/test/security-regression | fix(security): resolve highest-severity findings | Fix reproducible auth/media/privacy defects | No critical/high regression remains |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C088 | T16 | phuc/test/e2e-regression | test(e2e): cover registration to session restoration | Verify email with dev mailbox, login and reload | Browser E2E journey passes |
| C089 | T16 | phuc/test/e2e-regression | test(e2e): cover video expert QA and owner report | Upload sample, assign, notes, QA, owner claim | End-to-end journey passes |
| C090 | T16 | phuc/test/e2e-regression | test(e2e): cover matching revocation and decisions | Confirm then revoke, block and accept | No leaked claim; mutual state correct |
| C091 | T16 | phuc/test/e2e-regression | test(accessibility): audit expert and member forms | Keyboard labels/errors/mobile responsiveness | Major a11y issues closed |
| C092 | T16 | phuc/test/e2e-regression | fix(integration): resolve contract and schema regressions | Fix API DTO mismatches and response states | Web/API build and negative tests pass |

## D9

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C093 | T17 | release/v0.1.0 | fix(release): finalize auth security and migration defects | Fix tests, ensure deterministic migrations and cleanup | Build/migrate/rollback smoke pass |
| C094 | T17 | release/v0.1.0 | test(release): execute privacy and permission checklist | Run AUTH/MEDIA/REVIEW negative matrix | No open critical/high security issue |
| C095 | T17 | release/v0.1.0 | docs(release): document deployment secret and data policies | Runbook for cookies, mail, MinIO, staff access | Reviewer signs checklist |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C096 | T18 | release/v0.1.0 | fix(release): close expert workflow and matching defects | Triage E2E and review race issues | QA gate scenarios green |
| C097 | T18 | release/v0.1.0 | test(release): validate full demo fixtures and QA evidence | Synthetic members/reviewer/report; clean setup | Demo runs twice after clean reset |
| C098 | T18 | release/v0.1.0 | docs(release): prepare v0.1.0 notes and known limitations | Document non-production/staff MFA restrictions | Notes reviewed by Huong |

## D10

### Huong

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C099 | T19 | release/v0.1.0 | test(release): recheck reset session privacy and deletion | Re-run auth/media/owner IDOR and revoke tests | Regression evidence attached to release PR |
| C100 | T19 | release/v0.1.0 | docs(security): sign off access and retention constraints | Review user-data and expert data restrictions | No misleading production-ready label |
| C101 | T19 | release/v0.1.0 | docs(release): reconcile approved fixes and backmerge record | Document fixed issues and PR/SHA mapping; backmerge separately | Verified changelog cross-references merged commits |

### Phuc

| ID | Ticket | Branch | Message | Task scope | Verification |
|---|---|---|---|---|---|
| C102 | T20 | release/v0.1.0 | test(demo): run complete guided acceptance journey | Register→verify→video→review→approve→match | Demo passes with permitted sample data |
| C103 | T20 | release/v0.1.0 | docs(readme): finalize runbook screenshots and issue list | Explain setup/build/known gaps/repro steps | Fresh developer follows README |
| C104 | T20 | release/v0.1.0 | docs(release): finalize release evidence and known limitations | Document CI results, migration evidence and residual limitations before tag | Release evidence committed; tag separately only after approval |

