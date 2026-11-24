# Upload and host handoff

**Production release: blocked.** The archive is source prepared for a Linux host, not a production-approved application. Read [the audit](../docs/DEPLOYMENT-AUDIT.md) before admitting real users. Domain registration alone cannot run this application. Outstanding lifecycle/recovery implementation and policy approvals must be completed separately.

Update: the accompanying [recovery/closure implementation](../docs/PRODUCTION-RECOVERY-AND-CLOSURE.md) adds the independent journal and receipt-driven minimization. The owner-approved consent/minimization files are supplied in a separate deployment-only policy archive outside Git; its private signing key is excluded. Final retention/purge, status-window identity minimization, staff/provider setup and hosted acceptance are still required. Set the four policy environment paths to the installed approved files, and run `npm run release:preflight:production` in addition to the public HTTPS smoke check.

The separate approved-policy archive contains `deploy/consent/{approved.json,authority.pub}` and `deploy/closure/{approved.json,authority.pub}` plus its approval record. Copy those two subdirectories into `/etc/vera-match/consent` and `/etc/vera-match/closure` respectively, with root ownership and read access for the API service. Do not transfer the `operator-only` directory or signing private key to the API/web host. The signed publication/minimization approvals expire on 2027-02-22 and require an authorized renewal; this is approval validity, not a data-retention duration.

## What to obtain

Use one Linux VPS with Node.js 24, nginx, PostgreSQL 18 and FFmpeg/FFprobe. Use an authenticated SMTP provider and a private S3-compatible storage endpoint supporting the existing MinIO integration. A hosting operator can configure these using this folder; no credentials should be sent in chat. Point the domain's DNS to the web server and obtain a valid TLS certificate. The repository does not include a hosting account or automatically purchase infrastructure.

Keep the API single-process. Expose only HTTPS/HTTP for the application and restricted operator SSH. Keep the API, PostgreSQL and storage administration ports private. Restrict storage credentials to the application's private bucket; configure signed-upload CORS for the exact HTTPS app origin. Never enable anonymous bucket access.

## Archive contents

From the preparation checkout, run `npm run deploy:package`. Upload `dist/release/vera-match-source.tar.gz` and its `.sha256` file. The archive contains source, migrations, the lockfile, service/nginx templates, environment examples and a per-file SHA-256 manifest. It excludes ignored local secrets, `.git`, dependencies and generated build outputs. The manifest records the base commit; it includes working-copy fixes and does not represent a pushed commit or release approval.

## Host procedure

An operator performs these steps after the above prerequisites exist:

1. Verify the archive with `sha256sum -c vera-match-source.tar.gz.sha256` and extract into a fresh `/srv/vera-match` directory. Keep the previous release available for code rollback; database rollback is a separate reviewed procedure.
2. Create the `vera` service user. Copy `api.env.example` and `web.env.example` to `/etc/vera-match/api.env` and `/etc/vera-match/web.env`. Replace every placeholder. Make the files root-owned, readable by group `vera` only, with mode `0640`. Keep all private signing material outside the API process. Generate the stable matching key once; do not rotate it on restart.
3. Build as the release owner, with trusted host environment loaded and no shell tracing:

   ```sh
   cd /srv/vera-match
   set -a
   . /etc/vera-match/api.env
   . /etc/vera-match/web.env
   set +a
   npm ci
   npm run prisma:validate
   npm run prisma:generate
   npm run test:release-config
   npm test
   npm run build
   npm run lint
   npm audit --omit=dev --audit-level=high
   npm run release:preflight
   ```

4. Have an approved backup/recovery plan. Inspect `npx prisma migrate status --schema apps/api/prisma/schema.prisma`. Pending migrations on a new database are expected. An authorized operator applies reviewed migrations with `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`, then verifies status. Never run development migration/reset against production. Do not open real-user traffic while recovery remains blocked.
5. Configure and verify the independent journal as described in [recovery preparation](../docs/PRODUCTION-RECOVERY-AND-CLOSURE.md), and explicitly bind a fresh migrated database before its first API start. Never run the initialization command on a restore target. Install the existing systemd templates into `/etc/systemd/system/`. Check `/usr/bin/node` against the actual Node.js installation. Ensure `vera` can read the release, and create `/srv/vera-match/apps/web/.next/cache` writable by `vera`. Other application files should remain read-only to the runtime user. Start with `systemctl daemon-reload` and `systemctl enable --now vera-api vera-web`. Inspect both service journals without sharing secret values.
6. Replace `example.invalid` and certificate paths in `nginx/vera-match.conf`, install the virtual host, run `nginx -t`, then reload nginx. Do not expose the API origin directly or enable unrestricted proxy trust. The existing API limiter counts the proxy address; per-client production acceptance remains required.
7. Run `npm run release:preflight -- --url https://YOUR_DOMAIN` on the host. Verify real email delivery, private storage, cookie/proxy behavior and browser flows with synthetic accounts. Install the actual approved policy/staff configuration and verify scoped staff access before real-user acceptance.

## Release acceptance

The [latest baseline CI](https://github.com/24520637/vera-match/actions/runs/45344103856) is red; integrate the accompanying approval race fix and rerun the entire pipeline on the final SHA. Local targeted tests do not replace the complete candidate CI run. Resolve the production blockers in [release preparation](../docs/RELEASE-PREPARATION.md) and the audit, then obtain actual release sign-off. This bundle does not publish policies, fabricate lifecycle receipts, implement the independent recovery journal or claim those gates have passed.
