# T20 internal demo runbook

Run this from a clean checkout with synthetic adult members, staff and recordings. The demo exercises the real browser, API, PostgreSQL, SMTP and private MinIO paths through an isolated Nest test host. The fixture supplies test-only staff assurance, training and consent-policy evidence. [Test source](../apps/web/tests/expert-review.video-e2e.ts) · [C102 verification](T20-C102-RESULTS.md)

## 1. Checkout and tools

- Git, Node.js 24 (see [`.nvmrc`](../.nvmrc)), npm and enough disk for an independent `npm ci`, Chromium and a production build.
- PostgreSQL 18 with `initdb`, `pg_ctl`, `createdb` and `psql`. Use a dedicated native cluster on loopback port 5433.
- Native Mailpit and MinIO server executables. The recorded runs used Mailpit 1.33.1 and a local MinIO development build. CI shows how to obtain Mailpit and build a pinned MinIO revision from source. [CI provisioning](../.github/workflows/ci.yml)
- Native FFmpeg and FFprobe in the same directory. Check for `libvpx` and `libx264` in the FFmpeg build. The joined case generates WebM. The broader video suite also generates MP4.

For the verified baseline, run these PowerShell commands. Use the candidate SHA instead when reproducing a newer revision. Read this runbook alongside the pinned source if the historical checkout predates the runbook.

```powershell
git clone https://github.com/24520637/vera-match.git vera-match-t20
Set-Location vera-match-t20
git switch --detach 07e0d23a84046d55f36d15ee558de8f3e9124ab3
git rev-parse HEAD
git status --short
npm.cmd ci
npm.cmd exec -- playwright install chromium
```

Stop at a failing command. The video runner and Playwright config are tracked. Install this checkout's own dependencies and use the Chromium revision from its lockfile. Start a clean PowerShell session without other database, SMTP, storage or AWS configuration. Leave `.env`, `apps/api/.env` and `apps/web/.env` absent for this procedure.

## 2. Provision one isolated run

Use one PowerShell shell for the setup and test so environment variables stay scoped to it. Supply absolute paths to the four tool locations. The commands in this section create a fresh cluster and stores. Use `netstat -ano` to check IPv4 and IPv6 before starting. Ports 5433, 1025, 8025, 9000, 9001, 4100 and 3100 should be free for a fresh cluster. If you deliberately retain a dedicated T20 cluster between runs, verify its data directory and DB with the SQL below and use new Mailpit and MinIO stores and a fresh runner schema and bucket for each run. Keep other worktrees and services outside this fixture.

```powershell
$pgBin = 'C:\path\to\PostgreSQL\18\bin'
$mailpitExe = 'C:\path\to\mailpit.exe'
$minioExe = 'C:\path\to\minio.exe'
$ffmpegBin = 'C:\path\to\ffmpeg\bin'
& "$pgBin\postgres.exe" --version
& "$ffmpegBin\ffmpeg.exe" -version | Select-Object -First 1
& "$ffmpegBin\ffprobe.exe" -version | Select-Object -First 1
& "$ffmpegBin\ffmpeg.exe" -hide_banner -encoders 2>$null | Select-String 'libvpx|libx264'
netstat -ano | Select-String ':(5433|1025|8025|9000|9001|4100|3100)\s+.*LISTENING'

$run = Join-Path (Get-Location).Path ('.venv\t20\' + [guid]::NewGuid().ToString('N'))
$pgData = Join-Path $run 'pg-data'
$minioData = Join-Path $run 'minio-data'
$minioCerts = Join-Path $run 'minio-certs'
New-Item -ItemType Directory -Path $run,$minioData,$minioCerts | Out-Null
$pgPassword = [guid]::NewGuid().ToString('N')
$passwordFile = Join-Path $run 'initdb-password'
try {
  [IO.File]::WriteAllText($passwordFile, $pgPassword + [Environment]::NewLine)
  & "$pgBin\initdb.exe" -D $pgData -U postgres -A scram-sha-256 --pwfile=$passwordFile --no-locale -E UTF8
  if ($LASTEXITCODE -ne 0) { throw 'T20 initdb failed' }
} finally {
  if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
}
& "$pgBin\pg_ctl.exe" start -D $pgData -l (Join-Path $run 'postgres.log') -o '-h 127.0.0.1 -p 5433' -w -t 15
if ($LASTEXITCODE -ne 0) { throw 'T20 PostgreSQL startup failed' }
$env:PGPASSWORD = $pgPassword
& "$pgBin\createdb.exe" -w -h 127.0.0.1 -p 5433 -U postgres vera_match_t20
if ($LASTEXITCODE -ne 0) { throw 'T20 database creation failed' }
$env:DATABASE_URL = 'postgresql://postgres:{0}@127.0.0.1:5433/vera_match_t20?schema=public&connect_timeout=3' -f $pgPassword
$psqlArgs = @('-X','-w','-h','127.0.0.1','-p','5433','-U','postgres','-d','vera_match_t20','-v','ON_ERROR_STOP=1')
& "$pgBin\psql.exe" @psqlArgs -c "SELECT current_database(), inet_server_port(), current_setting('data_directory');"
if ($LASTEXITCODE -ne 0) { throw 'T20 database identity check failed' }
```

Confirm the returned database and directory match `vera_match_t20` and `$pgData` before migrating. Apply the committed history to the new database. The baseline has 23 migrations.

```powershell
npm.cmd run prisma:validate
npm.cmd run prisma:generate
npm.cmd exec -- prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm.cmd exec -- prisma migrate status --schema apps/api/prisma/schema.prisma
```

Set the remaining variables and start Mailpit and MinIO. The runner itself sets `API_INTERNAL_ORIGIN=http://localhost:4100` and `MAILPIT_BASE_URL=http://127.0.0.1:8025`. It uses production mode for the build; the API fixture sets `NODE_ENV=test`, local SMTP and the session cookie options. `PLAYWRIGHT_BROWSERS_PATH` is optional when Chromium was installed to the standard Playwright cache. If you use a custom browser cache, use the same value for install and execution.

```powershell
$env:MINIO_ENDPOINT = 'http://127.0.0.1:9000'
$env:MINIO_ROOT_USER = 't20-' + [guid]::NewGuid().ToString('N')
$env:MINIO_ROOT_PASSWORD = [guid]::NewGuid().ToString('N')
$env:MINIO_API_CORS_ALLOW_ORIGIN = 'http://localhost:3100,http://127.0.0.1:3100'
$env:MINIO_UPDATE = 'off'
$env:SMTP_HOST = '127.0.0.1'
$env:SMTP_PORT = '1025'
$env:MAILPIT_BASE_URL = 'http://127.0.0.1:8025'
$env:VIDEO_DURATION_FFPROBE = Join-Path $ffmpegBin 'ffprobe.exe'
$env:PLAYWRIGHT_HTML_OUTPUT_DIR = Join-Path $run 'playwright-report'
$mailpitDb = Join-Path $run 'mailpit.db'
$mailpit = Start-Process -FilePath $mailpitExe -ArgumentList @(
  '--listen', '127.0.0.1:8025', '--smtp', '127.0.0.1:1025', '--database', ('"{0}"' -f $mailpitDb),
  '--disable-version-check', '--smtp-disable-rdns', '--smtp-allowed-recipients', '^[a-z0-9-]+@example\.invalid$'
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'mailpit.log') -RedirectStandardError (Join-Path $run 'mailpit-error.log')
$minio = Start-Process -FilePath $minioExe -ArgumentList @(
  'server', ('"{0}"' -f $minioData), '--address', '127.0.0.1:9000', '--console-address', '127.0.0.1:9001',
  '--certs-dir', ('"{0}"' -f $minioCerts), '--quiet', '--anonymous'
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'minio.log') -RedirectStandardError (Join-Path $run 'minio-error.log')
$run
$mailpit.Id
$minio.Id
```

Wait for both health endpoints to return HTTP 200. Check that the SMTP and Mailpit HTTP ports belong to `$mailpit.Id`, the MinIO ports belong to `$minio.Id`, and all fixture service listeners are on loopback. The web and API ports should still be free.

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8025/livez -TimeoutSec 5).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9000/minio/health/live -TimeoutSec 5).StatusCode
netstat -ano | Select-String ':(5433|1025|8025|9000|9001|4100|3100)\s+.*LISTENING'
```

## 3. Run the guided journey

Run the count checks in the cleanup section before launching. The tracked runner builds both workspaces, starts the Nest fixture API on port 4100 and Next.js on port 3100, and waits for API readiness. The HTML reporter uses `PLAYWRIGHT_HTML_OUTPUT_DIR`.

```powershell
git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $run 'sha.txt') -Encoding ascii
node scripts/run-video-e2e.cjs --grep "T18 demo" 2>&1 | Tee-Object -FilePath (Join-Path $run 'demo.log')
$runnerExit = $LASTEXITCODE
"Runner exit code: $runnerExit"
```

Expect `video-desktop` and `video-mobile` each to pass. Failure screenshots, when present, are under `apps/web/test-results`. Review artifacts before sharing them. Keep passwords, session cookies, activation tokens, signed storage URLs and real personal data out of screenshots and logs. Traces and video recording are disabled.

| Step | What to narrate and verify |
| --- | --- |
| Register and verify | The member declares they are an adult, registers in Chromium and receives an activation email in Mailpit. The test opens the link, verifies the email, signs in and reloads the protected account. |
| Upload and assign | Fixture helpers set up compatible profiles and consent, generate a short WebM clip, upload it through the real storage path and assign it to an eligible expert. Use separate identities for owner, peer, assigning staff, expert and QA. |
| Expert review | In the expert browser context, open the assignment, enter a timestamped observation with context and submit the draft for QA. The owner report stays hidden before approval. |
| Independent QA | Use the independent moderator context. The fixture supplies an assignment-scoped QA grant. The test checks denied and stale approval requests before the authorized moderator approves. |
| Owner claims | Open the approved report as the owner. The owner confirms a factual claim and enables sharing under current consent. The other member sees the permitted claim as a matching reason, with private review details withheld. |
| Reciprocal matching and withdrawal | Both members accept and see a mutual match. The journey also checks block/unblock, stale references, consent withdrawal and regrant, explicit claim revocation and suppression of a match after profile-matching consent is withdrawn. |

### Historical screenshots

These are unaltered desktop and mobile screenshots from the T18 full video suite's synthetic private-video playback case. They show the member video page with a synthetic recording. The focused C102 runs produced no screenshots because both passed and the config captures screenshots only on failure. [T18 evidence](T18-VERIFICATION.md) · [Screenshot-producing test](../apps/web/tests/private-video.video-e2e.ts) · [Desktop screenshot](ui-preview/t18-private-video/video-desktop.png) · [Mobile screenshot](ui-preview/t18-private-video/video-mobile.png)

## 4. Verify cleanup and handle a Windows teardown stall

Run these checks before and after the suite, while Mailpit and MinIO are still running. Each count should be zero and the manifest check should return `False`.

```powershell
& "$pgBin\psql.exe" @psqlArgs -Atc "SELECT count(*) FROM pg_namespace WHERE left(nspname,15) = 'vera_auth_test_';"
(Invoke-RestMethod 'http://127.0.0.1:8025/api/v1/messages?limit=1' -TimeoutSec 5).total
@'
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1,
  credentials: { accessKeyId: process.env.MINIO_ROOT_USER, secretAccessKey: process.env.MINIO_ROOT_PASSWORD },
});
client.send(new ListBucketsCommand({}), { abortSignal: AbortSignal.timeout(4000) })
  .then(result => console.log(result.Buckets?.length ?? 0))
  .catch(error => { console.error(error.name); process.exitCode = 1; })
  .finally(() => client.destroy());
'@ | node
Test-Path -LiteralPath apps/web/.video-e2e-runtime.json
```

On Windows, the T20 fix starts the web and API servers as direct children and logs each `owned PID` at startup and exit. The API receives an IPC shutdown request so it can close the app and clean up its fixtures. Check the exit lines, counts and ports even when both projects pass.

On baseline `07e0d23`, the two project results printed, but the runner continued waiting for three Node processes. If a Windows run stalls, open the active run's `demo.log` in a second PowerShell window. Use the `owned PID` entries on the fixed runner or the `[WebServer] (node:<PID>)` entries on the baseline, then use `netstat -ano` to find listeners on 3100 and 4100. Wait for both project results and for the fixture manifest to disappear. Verify each candidate with `Get-Process -Id <PID>`, matching its executable and start time to the current run and its PID to the log or process lineage. Stop only those verified processes with `Stop-Process -Id <verified PID>`. Record the PIDs, runner exit code and final counts. If ownership is unclear, a test is still running or fixture cleanup is incomplete, preserve the log and manifest and record the cleanup failure.

After the counts are recorded, stop only the Mailpit and MinIO processes started for this run, using their recorded process objects. Check that ports 1025, 8025, 9000, 9001, 3100 and 4100 are clear.

```powershell
foreach ($fixture in $mailpit,$minio) {
  if ($fixture -and -not $fixture.HasExited) {
    Stop-Process -InputObject $fixture -ErrorAction Stop
    $fixture.WaitForExit(5000)
  }
}
netstat -ano | Select-String ':(5433|1025|8025|9000|9001|4100|3100)\s+.*LISTENING'
```

For a cluster created solely for this run, use `& "$pgBin\pg_ctl.exe" stop -D $pgData -m fast -w -t 15` and verify port 5433 is clear as well. An explicitly retained dedicated T20 cluster can stay up. Preserve the evidence directory. Close the setup shell to discard the process-only credentials. If Next.js rewrites `apps/web/next-env.d.ts`, review that diff before keeping any generated change.

## Known issues and release gates

| Issue | Reproduction or check |
| --- | --- |
| Baseline Windows teardown stalls after both tests pass | At `07e0d23`, Playwright uses Windows `taskkill`, which returned access denied on this host. The T20 worktree fix passed the demo and two failure-path probes. Follow the PID procedure above if a run stalls. [Verification](T20-C102-RESULTS.md#windows-teardown-fix-verification) |
| A binary on disk may still lack a prerequisite | Check PostgreSQL 18 client tools, Chromium from the lockfile, and FFmpeg encoders before running. A minimal PostgreSQL bundle may omit client tools. |
| Port conflicts and existing fixture data stop a clean run | Check both address families, the manifest, schema count, bucket count and inbox. Start a new isolated fixture after the existing listener or fixture owner has been identified. |
| Public UI still uses development-era copy | The public footer says private review and matching are unavailable. Compare the footer with the working staff and member flows in the joined demo. |
| Security and operations evidence is limited to the synthetic environment | Public or real-user use requires reviewed staff identity/MFA, consent and retention policy, permitted disclosure, private storage/TLS, SMTP, HTTPS/cookies/proxy, account lifecycle and recovery safeguards. Already issued media links can remain valid until expiry. Hương leads the T17/T19 review and both owners review the release candidate. [Release limitations](RELEASE-NOTES-v0.1.0.md) · [Release gates](TEST-PLAN.md#release-gate) |

## Reproducibility checklist

A separate dependency-free checkout of the baseline was created successfully and the documented source paths were verified. A full walkthrough with a fresh dependency installation and an independent developer has yet to run.

- [ ] Record SHA, branch, tool versions and exit codes from a clean checkout with its own dependencies.
- [ ] Verify all service addresses, confirm the T20 PostgreSQL identity and record migration status.
- [ ] Use fresh Mailpit/MinIO stores and verify empty fixture counts and absent manifest.
- [ ] Run the exact focused command. Record desktop and mobile separately and preserve the HTML report and available screenshots.
- [ ] Verify zero residual fixture resources. Record Windows PID intervention if required and verify listeners closed.
- [ ] Keep raw evidence local or in restricted storage and record any failed or unrun step.
- [ ] Have a developer unfamiliar with the setup follow the README from a clean checkout and capture where they needed help.
