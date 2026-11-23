# T20 C102 verification

On 2026-11-23 (UTC+07), both runs executed `node scripts/run-video-e2e.cjs --grep "T18 demo"` at [`07e0d23a84046d55f36d15ee558de8f3e9124ab3`](https://github.com/24520637/vera-match/commit/07e0d23a84046d55f36d15ee558de8f3e9124ab3) on `phuc/test/t20-demo-release-evidence`. Each prepared a fresh schema and bucket against the dedicated T20 PostgreSQL cluster, with fresh Mailpit and MinIO stores. The base database had 23/23 migrations applied. The recorded worktree used already provisioned binaries and dependency junctions. Both runs used Windows, Node 24.21.0, npm 11.19.0, Prisma 6.19.3, PostgreSQL 18.7, Chromium 158.0.8127.18, Mailpit 1.33.1, a local MinIO development build and FFmpeg/FFprobe 9.0.2.

| Run | Desktop | Mobile | Playwright | Runner exit | Build through exit | Setup through final checks |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 1 | PASS, 14.0 s | PASS, 9.4 s | 2/2, 1.9 min | 0 | 167 s | 168 s |
| 2 | PASS, 13.1 s | PASS, 13.5 s | 2/2, 1.7 min | 0 | 134 s | 135 s |

Both runs showed zero fixture schemas, buckets and messages and an absent runtime manifest before and after. After both project results appeared, three run-owned Node processes were still active each time. Those PIDs were checked against the run log and process start times, then stopped. The runner exited 0 on each run after that intervention. Mailpit, MinIO and the web servers stopped. The dedicated PostgreSQL listener on port 5433 was retained.

The original local artifacts are kept in the ignored worktree folders `.venv/t20/c102-dbjP3J` and `.venv/t20/c102-Hj3MED`. Both folders contain the runner and service logs, `playwright-report/index.html`, `evidence.json` and `verification.md`. The second also contains `teardown-observation.json` and `cleanup-pids.log`. Those raw files are available in the execution worktree. This record is the portable summary for a clean checkout. Both runs passed and generated no failure screenshots.

## Windows teardown fix verification

On this Windows host, Playwright's shell-tree shutdown command `taskkill /T /F` returned `Access denied` on a disposable child process. Stopping that same child through its Node process handle succeeded. The Windows video setup now starts Next and the API directly, asks the API to clean up through IPC, and waits for the two owned processes to exit. The existing Playwright fixture teardown remains available to clean up the run's manifest resources.

The official focused command ran again on the T20 worktree with the uncommitted fix applied over `07e0d23`. Desktop passed in 14.5 s and mobile passed in 9.6 s. Playwright reported 2/2 in 32.6 s. Both owned server PIDs exited automatically. The runner exited 0 after 66 s and overall execution took 68 s. Before and after, schema, bucket and mail counts were zero and the runtime manifest was absent. Only the retained T20 PostgreSQL listener remained.

Two additional Windows probes exercised the video Playwright config. With a pre-existing listener on port 4100, setup exited 1, started no runner web servers and preserved that listener. With an invalid API database port, setup exited 1 and stopped the Next child that it had started. Neither probe left a fixture manifest or runner web listener. The local demo artifacts are in `.venv/t20/c102-MwI7vC` and the probe logs in `.venv/t20/windows-teardown-probes-MEsTnH`. These are worktree results. Integrated CI for `07e0d23` predates the fix.

## Final review on current develop

The isolated review clone merged `develop` at `e23a4d9` into PR #40 head `a2b1632`. Local merge `18ec228e3e05831d394e5a1103076fd7e570533a` and the uncommitted review fixes were used for two Windows runs. The first fixture was observed with all 24 committed migrations complete. Both runs failed on desktop and mobile at the synthetic media PUT. The diagnostic retry captured HTTP 507 `XMinioStorageFull` on both projects. The retry exited 1 after 94 s (95 s with fixture setup and final checks). The Windows runner automatically stopped both web-server processes in both runs. Schema, bucket and mail counts were zero, and the manifest was absent afterward.

The review added three passing regression tests for independent schema/bucket cleanup, retry after partial cleanup, and rejection of foreign manifests or endpoints. On the integrated tree, the occupied-port probe preserved the existing listener, and the API startup-error probe stopped the owned Next process. Raw evidence for the two failed attempts stays in the review clone’s ignored `.venv/t20/c102-HalMib` and `.venv/t20/c102-Vqhsq0` directories.

### Storage refusal follow-up

A direct S3 probe with the same native MinIO binary on the C: fixture volume reproduced the failure without Next, Nest or Playwright. The new isolated bucket was created with HTTP 200, a small synthetic PUT returned HTTP 507 `XMinioStorageFull`, and the bucket had zero objects. At the time, NTFS reported 1,927,897,088 available bytes out of 267,271,532,544, with caller-available and volume-free bytes equal. MinIO reports a minimum-free-drive refusal for this code. Bucket quota uses a different code. A detailed Windows quota query was denied. The stopped diagnostic store and its empty bucket were preserved locally.

The review fix probes writes to the owned bucket before provisioning PostgreSQL. A native startup check on the same volume returned the sanitized 507 diagnostic, exited 1 before readiness or Chromium, and left zero fixture schemas and buckets and no manifest. Evidence is under the review clone’s ignored `.venv/t20/minio-507-probe-7rVCHD` and `.venv/t20/minio-preflight-check-PIkT9U` directories.

### Successful integrated replay

On 2026-11-24 (UTC+07), the same review clone at `18ec228e3e05831d394e5a1103076fd7e570533a` with the uncommitted review fixes used a fresh MinIO store on C:. A direct synthetic S3 PUT returned HTTP 200 with 6,767,226,880 bytes available on the fixture volume. The local launcher removed its probe object and bucket and checked that the fixture was empty before starting Playwright. The D: fixture path was visible. It was outside the session’s writable scope, so its write access and MinIO behavior were **NOT RUN**.

| Check | Result |
| --- | --- |
| `node scripts/run-video-e2e.cjs --grep "T18 demo"` | **2 passed, 0 failed, 0 skipped**. Desktop 19.4 s, mobile 17.5 s. Playwright 55.7 s. Runner exit 0 in 103 s. |
| Owned synthetic PostgreSQL schema | **24/24 migrations** complete during API readiness, including C065. The base database retained 23. |
| Teardown | API and Next exited automatically. Zero residual schemas, MinIO buckets, Mailpit messages, runtime manifest or run-owned listeners. |
| Fixture unit tests | **4 passed, 0 failed, 0 skipped**. |

The official runner built API and web successfully. Both workspaces passed lint/TypeScript, and Prisma validation passed. Logs, Playwright HTML, migration counts and cleanup evidence are in the review clone’s ignored `.venv/t20/c102-OfGBD8` directory.

### Compatibility check on updated develop

A detached checkout at `3c0f8139dcea081844c3db6f72dd9300c76bfa39` contained all 15 proposed T20 files copied from the review clone. The branch was left at `18ec228`. This was a compatibility check of the proposed files against updated `develop`, using the existing dependency overlay.

On this checkout, direct S3 PUT on C: returned HTTP 200. The official joined demo passed **2/2** with no failures or skips. Desktop passed in 19.2 s and mobile in 12.7 s. The runner exited 0 after 89 s and its owned processes stopped automatically. PostgreSQL reported 24 completed fixture migrations during API readiness. Final checks found zero fixture schemas, MinIO buckets, Mailpit messages, manifests and owned listeners. Fixture regression tests passed 4/4. Evidence is in the review clone’s ignored `.venv/t20/verify-develop-3c0f813/.venv/t20/c102-BmvL3z` directory. The D: storage path and a fresh developer installation remain unverified.

See the [demo runbook](T20-DEMO-RUNBOOK.md) for setup and reproduction, the [tracked runner](../scripts/run-video-e2e.cjs) and [Playwright config](../apps/web/playwright.video.config.ts) for the command's behavior, and the [historical T18 record](T18-VERIFICATION.md) for earlier evidence.
