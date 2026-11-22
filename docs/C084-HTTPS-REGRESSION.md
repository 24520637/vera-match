# C084: disposable HTTPS cookie and proxy regression

Status: PARTIAL. This verifies a defined loopback TLS topology, not an approved deployment.

## Topology and trust

Chromium uses reserved `vera.test`, `sibling.vera.test` and `foreign.test` names mapped to loopback in this browser only. A disposable gateway terminates TLS on 3443, forwards to the actual Next server on 3140, which proxies to the actual Auth API on 4140. HTTP 3444 is a negative Secure-cookie control on a non-localhost name. No public DNS or hosts-file edit is needed.

The runner creates a short-lived test CA and leaf certificate. Windows imports only this CA into the current-user Root store and removes its exact fingerprint in finally. Linux imports it into an isolated NSS database under the test browser's temporary HOME. Node receives the public test CA through NODE_EXTRA_CA_CERTS. Windows import uses the documented noninteractive mode and may be refused by protected-root policy; do not automate its security dialog. In that case local browser execution is NOT RUN and Linux NSS CI must provide actual TLS evidence. Certificate validation remains enabled; a mismatched certificate hostname must fail navigation. No insecure TLS flags or ignoreHTTPSErrors bypass is used.

The test gateway discards client-supplied Forwarded/X-Forwarded-*/X-Real-IP claims and writes its observed transport metadata. Nest's existing untrusted-proxy behavior is unchanged. Socket-IP quotas therefore remain shared behind Next; this is not real-client-IP deployment acceptance or distributed rate limiting.

## Execution

Run `npm run test:https --workspace apps/web` with native PostgreSQL 18 on loopback port 5433 and ignored local configuration. The runner refuses remote databases, creates only a UUID-owned disposable auth schema and uses the real Argon2 login/session guard. It does not add a successful mock auth handler or staff assurance bypass.

Prerequisites: installed Playwright Chromium; Git's bundled OpenSSL and Windows certutil on Windows, or OpenSSL and libnss3-tools on Linux. The CI workflow installs the Linux certificate tooling and runs the same runner. No Docker or application dependency is added.

The runner builds the API and web before starting the fixture. Run browser/build suites sequentially because they share generated Next output and the guarded auth runtime metadata file. Existing HTTP Auth E2E remains a separate regression command.

## Acceptance cases

- Validated HTTPS and rejected certificate-name mismatch.
- Actual Set-Cookie and browser Secure, HttpOnly, host-only, Path=/ and configured SameSite=Lax.
- No cookie on sibling host or ordinary HTTP; cross-site POST withholds the Lax cookie, while safe top-level navigation sends it.
- Forged/missing Origin and cross-site mutations are denied without revoking the valid session.
- Temporary real browser offline state hides private content and restores the original session; remote logout-all during the outage results in 401 after reconnection.
- Bearer values are not accessible through document.cookie or browser storage and do not appear in observed client logs/URLs. Assertions expose booleans, not cookie values. Traces, screenshots and video capture are disabled for this suite.
- Rotating forwarding claims cannot evade the real Next/API IP quota; direct origin requests also retain the default socket-IP boundary. HTTP 429 preserves Retry-After.

## Cleanup and operational limits

Temporary keys and NSS state remain outside the repository and are removed only after checking the resolved path is the owned temporary directory. No CA/private key or local environment file is committed. The Windows trust-recovery.json contains the public fingerprint of this run's CA. If the runner is forcibly killed, inspect that owned record and remove only that fingerprint with `certutil -user -delstore Root <owned-fingerprint>` before removing the owned temporary directory. Never clear the Root store or delete unknown certificates.

An interrupted fixture can leave guarded auth metadata. Inspect its run ID/schema before using the existing teardown; never reset the shared database or auto-delete unknown schemas.

Real deployed HTTPS, proxy peers/hops, prevention of origin bypass, real distinct-client attribution, other configured SameSite modes, production SMTP/MFA/policies and production monitoring are NOT RUN here. C084 and T15 remain PARTIAL until those required acceptance gates are available.

## Verification evidence

Local evidence: PASS API/web production builds, TypeScript/lint, Prisma validate/generate, 250 unit tests, 48 PostgreSQL auth integration tests and all 36 existing HTTP Auth/Recovery browser tests. The new HTTPS runner reached certificate setup, but Windows protected-root import refused noninteractive trust; local HTTPS browser cases are NOT RUN (setup FAIL), not PASS. Linux CI must exercise the actual NSS-backed TLS browser suite at the PR head. No TLS validation bypass is an accepted workaround. Final CI evidence is recorded in the task PR.
