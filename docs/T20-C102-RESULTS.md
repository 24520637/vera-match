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

See the [demo runbook](T20-DEMO-RUNBOOK.md) for setup and reproduction, the [tracked runner](../scripts/run-video-e2e.cjs) and [Playwright config](../apps/web/playwright.video.config.ts) for the command's behavior, and the [historical T18 record](T18-VERIFICATION.md) for earlier evidence.
