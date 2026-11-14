# Local setup and MVP deployment limits

Use the current [README setup](../README.md) and [email authentication guide](EMAIL-AUTH-SESSIONS.md). Development uses Node.js 24, native PostgreSQL 18 at localhost:5433 and native Mailpit SMTP 1025/inbox 8025. No Docker is required. Keep credentials in ignored machine-local environment files. Preserve the committed initial migration; inspect migration status instead of recreating it. MinIO is a separate future media prerequisite.

## MVP limiter and network model

The implemented in-memory rate limiter is MVP-only and supports one API process. Its counters reset on restart and are not shared across workers or instances. Do not describe it as multi-instance production abuse protection. This PR adds no Redis or distributed infrastructure.

The API currently does not trust reverse-proxy forwarding headers. Direct requests use the socket client IP. Through a proxy, that proxy's socket address is the effective identity; many users may share its limit. Direct/proxy integration tests prove arbitrary forwarded headers cannot bypass this default, not that production real-client-IP handling is configured.

Before deployment behind a proxy, document the proxy topology and trusted peers/hops, replacement of client-supplied forwarding headers and prevention of direct-origin bypass. Configure only the agreed trust boundary and test actual distinct clients plus spoofed headers. Do not turn on unrestricted trust proxy. Before running multiple API processes, agree and verify shared rate limiting separately.

## Endpoints

- http://localhost:3000: public site and email-authentication UI; profiles, matching and private review remain separate features.
- http://localhost:4000/api/health: process liveness.
- http://localhost:4000/api/health/ready: PostgreSQL readiness.
- http://localhost:8025: Mailpit test inbox; this is not external delivery.

## Before production

Configure and verify HTTPS/Secure cookies, consistent web/API hostnames, exact CORS origin, secret management, authenticated TLS SMTP and real inbox delivery. Review the proxy/limiter gates above, inherited dependency advisories, backup/recovery, retention/deletion, staff access controls and feature-specific privacy/security acceptance. Local tests and successful CI do not establish production readiness.
