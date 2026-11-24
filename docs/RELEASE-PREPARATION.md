# Public demo and API documentation preparation

Current production preparation adds an independent journal/database binding, receipt-driven closure minimization and operator-approved signed policy artifacts. See [the implementation and host procedure](PRODUCTION-RECOVERY-AND-CLOSURE.md) and [the current audit](DEPLOYMENT-AUDIT.md). The historical preparation notes below do not establish hosted production readiness; final retention/identity minimization, real provider/staff setup and deployment acceptance remain required.

Status: code preparation only. No hosting, DNS, certificates, public API base URL or live website has been provisioned or verified by this change. A domain name alone does not provide an application server, database, SMTP or private object storage.

## Scope and dependencies

The generated OpenAPI contract covers 75 operations across 66 paths, including API discovery, account flows, staff MFA, moderator grants, consent, private video, review, safety and matching. Regression tests compare the generated operations with the registered routes and check summaries, descriptions, security requirements, request schemas, status codes, report enums and selected validators.

No authentication, consent, assignment, cleanup or release gate is relaxed. No legal policy is published. No local database migration or deployment is performed.

## Deliverable URLs after deployment

Replace YOUR_DOMAIN only when the domain and hosting have been selected. These are intended URL shapes, not working links today.

| Deliverable | Intended path |
| --- | --- |
| Live website | https://YOUR_DOMAIN/ |
| Public API base URL and discovery response | https://YOUR_DOMAIN/api |
| Online Swagger documentation | https://YOUR_DOMAIN/api/docs |
| OpenAPI JSON | https://YOUR_DOMAIN/api/docs-json |
| OpenAPI YAML | https://YOUR_DOMAIN/api/docs-yaml |
| Process liveness | https://YOUR_DOMAIN/api/health |
| PostgreSQL readiness | https://YOUR_DOMAIN/api/health/ready |

OpenAPI server URL is / because each operation already includes /api. Do not configure it as /api and accidentally produce /api/api paths. Browser requests and SSR reuse the existing same-origin Next.js API proxy and HttpOnly cookie contract; no new public token store or API client is introduced.

## Documentation exposure

API_DOCS_MODE accepts public or disabled. In production the default is disabled. Set public explicitly for the requested online documentation. Production Swagger UI is read-only (Try it out methods disabled) and never persists authorization. Public schema access does not grant access to any protected API. Request examples and schemas contain no real account records, tokens or signed object URLs. Do not run a public demo with NODE_ENV=test or synthetic staff/consent providers.

## Native deployment template

The committed deploy/systemd and deploy/nginx files are an optional Linux VPS template, not a purchased hosting recommendation or verified deployment. Node.js 24, PostgreSQL 18, native FFmpeg/FFprobe and private S3-compatible/MinIO storage remain prerequisites. No Docker is required. Adapt executable paths and service user to the selected host before installing. Managed hosting can use the same build/start commands and environment contract without systemd.

The web service listens on 127.0.0.1:3000. The API uses API_PORT=4000 and currently binds the platform default interface: block external access to that port with the host firewall/security group. Never expose PostgreSQL 5433, Mailpit 1025/8025, MinIO console 9001 or the local MinIO 9000 listener directly. External private object storage needs its own authenticated HTTPS endpoint reachable by signed-upload clients. It is not exposed through the web virtual host.

The nginx template forwards web traffic to Next.js, which rewrites /api to server-only API_INTERNAL_ORIGIN. Replace example.invalid and both certificate paths, obtain a valid certificate, validate nginx configuration, then install the virtual host. Keep the service origin unreachable directly. Client-supplied forwarding headers are overwritten at nginx, but the API still does NOT trust proxy headers: quotas see the proxy socket address and may be shared by visitors. This is an explicit single-process MVP limitation, not production per-client quota verification. No unrestricted trust proxy is enabled. Review the deployed proxy topology before changing that contract; multiple API processes require a reviewed shared limiter.

## Environment and build

Use the repository-root [`.env.example`](../.env.example) as the starting point for host configuration. Place secrets in host-owned files outside the checkout, readable only by the service user and root. For staging, use a separate PostgreSQL database, private storage bucket and keys. Configure `DATABASE_URL`, the same staging HTTPS origin in `APP_BASE_URL` and `CORS_ORIGIN`, secure cookies, authenticated TLS SMTP, HTTPS private storage with scoped credentials, `VIDEO_DURATION_FFPROBE` pointing to the installed binary, and `API_DOCS_MODE=public`. Generate a random 32-byte `MATCHING_HANDLE_KEY` encoded as 64 hexadecimal characters and keep it stable across restarts. Verify delivery with the SMTP provider used on the host.

The web needs API_INTERNAL_ORIGIN=http://127.0.0.1:4000 at BOTH build and runtime. A separate web host must use an approved private API origin instead. Never put this server-only variable or storage secrets in NEXT_PUBLIC_* variables. The API and web systemd EnvironmentFile paths are /etc/vera-match/api.env and /etc/vera-match/web.env. Create the vera service account and the .next/cache directory with appropriate ownership before enabling the templates; Next.js needs writable cache storage.

From the pinned release checkout, with host environment loaded privately:

    npm ci
    npm run prisma:validate
    npm run prisma:generate
    npm run test:release-config
    npm test
    npm run build
    npm run lint
    npm run release:preflight

Preflight uses the built API configuration parser and checks documentation mode, the internal API origin, matching key format and native decoder execution. Run the HTTPS smoke test below after starting the services. For member-flow acceptance on staging, also verify email delivery, private storage, signed consent publication and matching with synthetic accounts.

Before starting a new host, inspect prisma migrate status and have an approved backup/recovery plan. An authorized operator applies the already-reviewed additive migrations with prisma migrate deploy, never migrate reset, and never regenerates history. No startup service in this PR silently migrates a database. Start API and web only after schema compatibility is confirmed. Serve NODE_ENV=production; do not replace it with development to get around a failed gate.

## Post-deployment evidence

After DNS/TLS and both services are live:

    npm run release:preflight -- --url https://YOUR_DOMAIN

The smoke check verifies the website, API discovery/liveness/readiness JSON, Swagger UI and its read-only configuration, and expected OpenAPI routes. Protected Auth and Video routes must return 401 without a cookie. It sends only GET requests, follows no redirects, and sends no credentials. Run the applicable auth/cookie/proxy, private-media, SMTP and release-candidate browser checks against approved synthetic deployment data. Confirm no public anonymous bucket listing/GET and no publicly exposed administrative ports.

## Outstanding work before real-user release

| Gate | Required work and owner | Current behavior |
| --- | --- | --- |
| Published consent | Authorized owner approves exact EN/VI policy content, privacy basis and production registry | No synthetic policies enabled |
| Staff access | Install trusted staff authority and MFA keys, signed qualifications and approved consent. Verify scoped grants and the joined staff flow on staging. | Assignment and review access requires current staff assurance. QA grants bind the recipient's staff identity and enrollment epoch. |
| Closure completion | Verify the signed-policy receipt worker on the host and finalize retention/purge and post-window identity minimization. | MEDIA keeps its provider proof; the new worker records the other four domain receipts and reaches RETENTION_PENDING only under an exact approval. No final erasure is claimed. |
| Recovery | Provision the independently protected journal authority, explicitly bind a fresh database and rehearse the actual restored target before cutover. | Code now verifies signed checkpoints and conservatively quarantines missing restrictions. Pre-binding backups and isolated mode remain fenced. Hosted recovery acceptance is NOT RUN. |
| Retention | Authorized privacy/legal owner approves retention/purge and holds; implement reviewed minimization without tampering with immutable evidence | No automatic hard deletion based on provisional periods |
| Infrastructure | Hosting owner provisions domain/DNS, TLS, secrets, real SMTP, private storage, isolated DB, monitoring and access controls | Not provisioned by this PR |
| Release sign-off | Review current T17/T18/T20 evidence and the final release candidate | CI or online docs alone are not production approval |

Prepare and test independent code while these gates remain explicit. Do not advertise the full lifecycle or production recovery as complete.

References: [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header), docs/PRIVACY-LIFECYCLE-DECISIONS.md, docs/DEPLOYMENT.md and docs/C095-RESTRICTION-RECOVERY-EVIDENCE.md.

## Verification recorded during code preparation

The [integrated CI baseline](https://github.com/24520637/vera-match/actions/runs/45335511693) passed 37 steps at `c7c4de2`, including PostgreSQL, native MinIO, browser and disposable HTTPS tests. Recheck the candidate SHA after code or configuration changes. Validate the actual hosting configuration, DNS/TLS, SMTP, storage and staff workflow on staging before release.
