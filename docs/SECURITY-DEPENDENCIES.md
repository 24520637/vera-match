# Security dependency remediation

Audit date: 2026-11-19. Base: develop `b58f770` (PR #21 merged). Scope: dependency resolution and this inventory only; no authorization, schema, migration, UI or private-media behavior changes.

## Baseline and remaining findings

Fresh read-only registry audits supersede the older PR #21 snapshot; advisory data can change independently of this lockfile. Counts are affected package entries, including parent metavulnerabilities, not independent application defects.

| Audit | Before | After | Result |
| --- | --- | --- | --- |
| `npm audit` | 15 high, 12 moderate, 3 low (30 total) | 3 high, 9 moderate, 0 low (12 total) | FAIL: unresolved findings remain |
| `npm audit --omit=dev` | 11 high, 5 moderate, 0 low (16 total) | 3 high, 5 moderate, 0 low (8 total) | FAIL: unresolved findings remain |

Both snapshots contain zero critical findings. No advisory suppression, audit threshold change, forced fix or framework major upgrade was used. Production readiness is not established.

## Update strategy

Exact, major-scoped root overrides replace vulnerable transitive pins without upgrading Nest 10, Next 15, Prisma 6 or changing workspace dependency contracts. `npm ci` must reproduce the lockfile; changing only node_modules is insufficient. Remove each override when the owning upstream package incorporates a reviewed patched dependency, and rerun this matrix.

| Package | Before | Selected | Reason |
| --- | --- | --- | --- |
| `body-parser@1` | 1.20.4 | 1.20.9 | Patched release within existing major. |
| `multer@2` | 2.0.2 | 2.5.0 | Patched release within existing major. |
| `lodash@4` | 4.17.21 | 4.18.1 | Patched release within existing major. |
| `js-yaml@4` | 4.1.0 | 4.3.2 | Patched release within existing major. |
| `postcss@8` | 8.4.31 | 8.5.23 | Patched release within existing major. |
| `qs@6` | 6.14.3 | 6.16.1 | Patched release within existing major. |
| `picomatch@4` | 4.0.1 | 4.0.4 | Patched release within existing major. |
| `ajv@8` | 8.12.0 | 8.18.0 | Patched release within existing major. |
| `webpack@5` | 5.97.1 | 5.104.1 | Patched release within existing major. |
| `glob@10` | 10.4.5 | 10.5.0 | Fix CLI injection; retain documented moderate blockers. |
| `inquirer@8` | 8.2.6 | 8.2.7 | Supported patch removes vulnerable external-editor/tmp chain. |
| `inquirer@9` | 9.2.15 | 9.3.8 | Supported patch removes vulnerable external-editor/tmp chain. |

Webpack 5.104.1 introduces its upstream-supported es-module-lexer 2.3.2 and schema-utils 4.8.5 / ajv-formats 3.0.1 subtree; these are build-tool internals, not application dependency/API major upgrades. Inquirer patches replace the external-editor/chardet/iconv-lite subtree. qs resolution also refreshes object-inspect 1.13.4 to 1.14.0. These changes are covered by clean install, CLI compilation and regressions.

## Advisory inventory and exposure

This lists every direct advisory in the baseline. Parent-only entries inherit their leaf finding and are mapped separately below. Patch decisions are not risk acceptances; reduced current reachability does not remove an advisory.

### @nestjs/core

Path: `apps/api -> @nestjs/core`. Baseline 10.4.22.

API runtime; advisory concerns user-controlled SSE type/id. No @Sse/EventSource path found in current application sources. Remaining advisory is not accepted as resolved.

UNRESOLVED: first patched core 11.1.18; Nest 10 has no patched release. Requires coordinated framework/Express migration, not a single-package override.

- [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — moderate; affected `<=11.1.17`; @nestjs/core Improperly Neutralizes Special Elements in Output Used by a Downstream Component ('Injection').

### ajv

Path: `apps/api -> @nestjs/cli -> @angular-devkit/core -> ajv`. Baseline 8.12.0.

Build/scaffolding validation via Nest CLI -> Angular devkit; no application use of attacker-controlled $data schemas found.

Applied 8.18.0.

- [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) — moderate; affected `>=7.0.0-alpha.0 <8.18.0`; ajv has ReDoS when using `$data` option.

### body-parser

Path: `apps/api -> @nestjs/platform-express -> body-parser; also -> express -> body-parser`. Baseline 1.20.4.

API runtime via Nest Express and Express. JSON request parsing is active; compressed untrusted request bodies make this a priority. Same-major patched parser preserves the existing configuration.

Applied 1.20.9.

- [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6) — low; affected `<1.20.6`; body-parser vulnerable to denial of service when invalid limit value silently disables size enforcement.
- [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) — high; affected `<1.20.9`; body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body.

### deepmerge-ts

Path: `apps/api -> prisma -> @prisma/config -> deepmerge-ts; @prisma/client optional prisma peer also included by production audit`. Baseline 7.1.5.

Prisma CLI/config dependency (also counted by production audit through the optional Prisma peer). No application import; plain HTTP JSON cannot itself carry cyclic object graphs. Do not feed untrusted executable config to Prisma.

UNRESOLVED: patched in 8.0.0; Prisma 6.19.3 pins 7.1.5. Major transitive override or Prisma migration requires separate compatibility review.

- [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) — high; affected `<8.0.0`; DeepmergeTS has stack exhaustion when merging recursive object graphs.

### file-type

Path: `apps/api -> @nestjs/common -> file-type`. Baseline 20.4.1.

Nest common dependency. Current direct-to-MinIO video confirmation does not use Nest FileTypeValidator/multipart file interceptors; no such application call site found. Still vulnerable in the installed tree.

UNRESOLVED: both advisories require >=21.3.2; Nest 10 pins 20.4.1. No unreviewed ESM/API major override.

- [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473) — moderate; affected `>=13.0.0 <21.3.1`; file-type affected by infinite loop in ASF parser on malformed input with zero-size sub-header.
- [GHSA-j47w-4g3g-c36v](https://github.com/advisories/GHSA-j47w-4g3g-c36v) — moderate; affected `>=20.0.0 <=21.3.1`; file-type: ZIP Decompression Bomb DoS via [Content_Types].xml entry.

### glob

Path: `apps/api -> @nestjs/cli -> glob@10`. Baseline 10.4.5.

Development Nest CLI file discovery. CLI command injection fixed by 10.5.0; cancellation/minimatch advisories remain. Do not build untrusted projects or pass attacker-controlled glob CLI commands.

Applied 10.5.0 for command injection. Cancellation advisory requires >=14.0.2 (major); minimatch >=11.0.1 is also a major dependency change.

- [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) — high; affected `>=10.2.0 <10.5.0`; glob CLI: Command injection via -c/--cmd executes matches with shell:true.
- [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) — moderate; affected `>=9.0.0 <=14.0.1`; Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal.

### js-yaml

Path: `apps/api -> @nestjs/swagger -> js-yaml@4; CLI/Jest config readers also share this major`. Baseline 4.1.0.

Swagger dependency and development config readers. Current Swagger document is generated from application metadata, not uploaded YAML. Patch protects parsing consumers without changing API routes.

Applied 4.3.2.

- [GHSA-mh29-5h37-fv8m](https://github.com/advisories/GHSA-mh29-5h37-fv8m) — moderate; affected `>=4.0.0 <4.1.1`; js-yaml has prototype pollution in merge (<<).
- [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) — moderate; affected `>=4.0.0 <=4.1.1`; JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases.
- [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) — high; affected `>=4.0.0 <4.3.0`; js-yaml: YAML merge-key chains can force quadratic CPU consumption.
- [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) — high; affected `>=4.0.0 <4.3.1`; JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported.
- [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) — high; affected `>=4.0.0 <4.3.2`; js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources.

### lodash

Path: `apps/api -> @nestjs/config / @nestjs/swagger -> lodash; CLI consumers share it`. Baseline 4.17.21.

Config/Swagger and CLI dependencies. No direct application _.template/omit/unset/pullAt call found. Same-major patch removes the vulnerable implementation from these paths.

Applied 4.18.1. Version 4.18.0 is deprecated as a bad release and was rejected.

- [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) — high; affected `>=4.0.0 <=4.17.23`; lodash vulnerable to Code Injection via `_.template` imports key names.
- [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) — moderate; affected `>=4.0.0 <=4.17.22`; Lodash has Prototype Pollution Vulnerability in `_.unset`, `_.omit`, and `_.pullAt` functions.

### minimatch

Path: `apps/api -> @nestjs/cli -> glob@10 -> minimatch@9`. Baseline 3.1.5.

Nest CLI -> glob@10 -> minimatch@9; development file matching, not a current HTTP endpoint. Fixed line 11.0.1 is a major transition and needs upstream/toolchain review.

UNRESOLVED: >=11.0.1; current glob 10 uses minimatch 9.0.9.

- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) — moderate; affected `>=7.0.0 <11.0.1`; minimatch has potential denial of service via globparts amplification.

### multer

Path: `apps/api -> @nestjs/platform-express -> multer`. Baseline 2.0.2.

Nest Express runtime dependency. Current video upload is presigned storage upload, not a multipart API interceptor; no registered multipart application route found. Updated defensively within major 2.

Applied 2.5.0.

- [GHSA-xf7r-hgr6-v32p](https://github.com/advisories/GHSA-xf7r-hgr6-v32p) — high; affected `<2.1.0`; Multer vulnerable to Denial of Service via incomplete cleanup.
- [GHSA-v52c-386h-88mc](https://github.com/advisories/GHSA-v52c-386h-88mc) — high; affected `<2.1.0`; Multer vulnerable to Denial of Service via resource exhaustion.
- [GHSA-5528-5vmv-3xc2](https://github.com/advisories/GHSA-5528-5vmv-3xc2) — high; affected `<2.1.1`; Multer Vulnerable to Denial of Service via Uncontrolled Recursion.
- [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j) — high; affected `>=1.0.0 <2.2.0`; Multer vulnerable to Denial of Service via deeply nested field names.
- [GHSA-3p4h-7m6x-2hcm](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm) — moderate; affected `>=2.0.0-alpha.1 <2.2.0`; Multer vulnerable to Denial of Service via incomplete cleanup of aborted uploads.
- [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) — high; affected `<2.3.0`; multer vulnerable to Denial of Service via crafted multipart field names.
- [GHSA-qvfw-j98x-7q72](https://github.com/advisories/GHSA-qvfw-j98x-7q72) — low; affected `<2.3.0`; multer vulnerable to file size limit bypass via async fileFilter race condition.
- [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4) — high; affected `<2.3.0`; multer vulnerable to Denial of Service via oversized array index in field names.
- [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) — high; affected `>=2.0.0 <2.5.0`; multer vulnerable to Denial of Service via a pending asynchronous fileFilter after request teardown.

### picomatch

Path: `apps/api -> @nestjs/cli -> @angular-devkit/core -> picomatch@4`. Baseline 4.0.1.

Nest CLI -> Angular devkit file matching. Development/build exposure; no direct public glob-matching API.

Applied 4.0.4.

- [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) — moderate; affected `>=4.0.0 <4.0.4`; Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching.
- [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) — high; affected `>=4.0.0 <4.0.4`; Picomatch has a ReDoS vulnerability via extglob quantifiers.

### postcss

Path: `apps/web -> next@15.5.29 -> postcss`. Baseline 8.4.31.

Next build CSS pipeline, shipped as a production dependency. Current CSS is repository-controlled; no user-supplied CSS/source maps accepted. Same-major patched parser retains Next 15.

Applied 8.5.23.

- [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — moderate; affected `<8.5.10`; PostCSS has XSS via Unescaped </style> in its CSS Stringify Output.
- [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) — high; affected `<=8.5.11`; PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments.
- [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) — moderate; affected `<=8.5.22`; PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset.
- [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — high; affected `<=8.5.17`; PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure.

### qs

Path: `apps/api -> @nestjs/platform-express -> express / body-parser -> qs`. Baseline 6.14.3.

Express query parsing and body-parser. Untrusted request inputs reach parsing, although the reported stringify options are not directly used by application code. Patch both transitive paths.

Applied 6.16.1.

- [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) — moderate; affected `>=6.11.1 <=6.15.1`; qs has a remotely triggerable DoS: qs.stringify crashes with TypeError on null/undefined entries in comma-format arrays when encodeValuesOnly is set.
- [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) — moderate; affected `>=6.14.2 <=6.15.3`; qs array-limit bypass via bracket-key comma parsing.
- [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) — moderate; affected `>=2.2.5 <6.16.0`; qs: Denial of Service via Attacker Controlled isBuffer.
- [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) — moderate; affected `>=6.7.0 <=6.16.0`; qs : qs.stringify with arrayFormat 'comma' throws an uncaught TypeError on array elements carrying a non-callable own toString (DoS).

### tmp

Path: `apps/api -> @nestjs/cli -> inquirer@8 / @angular-devkit/schematics-cli -> inquirer@9 -> external-editor -> tmp`. Baseline 0.0.33.

Nest CLI -> inquirer -> external-editor temporary files. Local CLI filesystem/symlink exposure; fixed by supported inquirer patch releases that replace the old external-editor chain.

Removed old external-editor/tmp@0.0.33 through inquirer 8.2.7 and 9.3.8. The replacement no longer installs tmp; a direct tmp upgrade would require >=0.2.6.

- [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6) — low; affected `<=0.2.3`; tmp allows arbitrary temporary file / directory write via symbolic link `dir` parameter.
- [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) — high; affected `<0.2.6`; tmp has Path Traversal via unsanitized prefix/postfix that enables directory escape.

### webpack

Path: `apps/api -> @nestjs/cli -> webpack`. Baseline 5.97.1.

Nest CLI development/build dependency. No application buildHttp plugin configuration found. Patch both upstream build-time SSRF advisories.

Applied 5.104.1.

- [GHSA-8fgc-7cc6-rx7x](https://github.com/advisories/GHSA-8fgc-7cc6-rx7x) — low; affected `>=5.49.0 <=5.104.0`; webpack buildHttp: allowedUris allow-list bypass via URL userinfo (@) leading to build-time SSRF behavior.
- [GHSA-38r7-794h-5758](https://github.com/advisories/GHSA-38r7-794h-5758) — low; affected `>=5.49.0 <5.104.0`; webpack buildHttp HttpUriPlugin allowedUris bypass via HTTP redirects → SSRF + cache persistence.

## Parent findings and unresolved work

The baseline parent-only entries are @angular-devkit/core, @angular-devkit/schematics, @angular-devkit/schematics-cli, @nestjs/cli, @nestjs/common, @nestjs/config, @nestjs/platform-express, @nestjs/schematics, @nestjs/swagger, @nestjs/testing, @prisma/config, external-editor, inquirer, next and prisma. Their remediation follows the leaf paths above; no separate hidden fix exists.

Remaining full-tree entries: `@nestjs/cli`, `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@nestjs/testing`, `@prisma/config`, `deepmerge-ts`, `file-type`, `glob`, `minimatch`, `prisma`. Production-only entries: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@prisma/config`, `deepmerge-ts`, `file-type`, `prisma`.

The three remaining high entries are **one deepmerge-ts finding propagated through @prisma/config and prisma**. npm includes this optional Prisma CLI peer even with --omit=dev. Keep this visible; do not relabel it as dev-only or remove a required CLI just to improve counts. No untrusted recursive-config path was found in current application sources.

Follow-up requires jointly reviewed Nest/CLI (core SSE, file-type, glob/minimatch) and Prisma/config upgrades. Registry audit suggests newer framework majors and can suggest Prisma downgrades; neither is a reviewed compatibility strategy. Phuc should review the shared build-tool impact and rerun assignment/workspace suites after integrating this lockfile. His unmerged branches are not part of this delivery. Production MFA, approved consent policies, deployment topology and retention gates remain independent.

## Verification

Local verification used Node 26.8.2 / npm 11.19.1 on Windows. The unchanged CI workflow uses Node 24 from .nvmrc; see the remediation PR for the fresh run at its exact head.

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Clean npm ci and npm ls --all | PASS | Lockfile reproduces; no invalid dependency tree. |
| Prisma validate / generate | PASS | Existing Prisma 6 client/schema; no migration edits. |
| API + web production builds | PASS | Nest 10 / Next 15 retained. |
| TypeScript / npm run lint | PASS | Both workspaces. |
| API unit tests | PASS | 250 tests, 23 suites. |
| PostgreSQL / migrations / native MinIO integration | PASS after targeted service-recovery retry | Full recorded run: 332 passed, 18 video tests failed because MinIO was stopped after a tool-host interruption; after restarting native services, the complete video suite passed 18/18. All 350 cases verified across those runs, not a single uninterrupted green run. |
| Native MinIO privacy | PASS | Dedicated suite 2/2 and security-media suite; private buckets, owner/expert denial, actual signed expiry. |
| UI / accessibility Playwright | PASS | 118 desktop/mobile tests. |
| Auth / recovery browser E2E | PASS | 36 tests; actual Mailpit and API, sessions, reset/revocation, CSRF and 429. |
| Member / Safety / Video browser E2E | PASS | 2 / 4 / 2 tests with actual API; video uses native MinIO. |
| Nest CLI schematics dry-run | PASS | generate service --dry-run --no-spec; no files created. |
| Full / production npm audit | FAIL | Remaining findings and upgrade blockers above, not suppressed. |
| Deployed production topology / real MFA / real policy approval | NOT RUN | Independent production gates; no readiness claim. |

An earlier integration process timed out before its final output was recovered during the tool-host interruption. No application failure is inferred from that incomplete run; the durable recorded runs above identify the actual service failure and successful retry.

Tests use loopback native services and disposable schemas/buckets only. No public-schema migration, database reset, developer data mutation, local-secret change, approved-policy substitution or production MFA bypass was performed. All 12 existing migrations remain unchanged. Phuc review is requested for shared toolchain compatibility; his open PR #18/#22 code was not merged into this branch.