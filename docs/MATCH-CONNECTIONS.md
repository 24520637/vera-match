# Mutual match profiles and text chat

After both members accept, **Your matches → Decision history → View profile and chat** opens the connection. A link is account/session-bound and expires after 15 minutes. Refresh decision history to obtain a fresh link. Existing accepted decisions are preserved by the additive migration.

Each member saves three independent choices for that specific person. All choices start off, including on existing mutual matches.

- **Share my profile** exposes display name, age, city, occupation, bio, relationship goal, interests, values and the chosen connection photo. Date of birth is not returned.
- **Share my account email** exposes the verified account email. No phone number is collected or invented.
- **Enable chat** permits reading/sending only while both members enable it. Text messages are limited to 2,000 UTF-16 code units. The page checks for updates every 10 seconds while visible. No email notification or attachment delivery is included.

The profile comes from the owner's existing profile settings. Photo selection is per connection. The browser resizes JPEG/PNG/WebP up to 5 MB into a small image. The API validates decoded image content, limits pixel count, rejects animation, and re-encodes WebP without source metadata. Photos are stored privately in PostgreSQL, up to 65,536 bytes, and returned as data URLs only through authorized connection reads.

## Authorization and revocation

Every connection request rechecks both ACCEPT decisions, current matching consent generations, reciprocal eligibility, visible active adult member profiles, caller session, and blocks. Participant user locks serialize sharing/message operations with safety restrictions. Staff roles and other members cannot read the connection. Origin/JSON validation, shared matching quotas and private/no-store responses apply to the new endpoints.

Turning off profile/email sharing removes it from future reads. Turning off chat denies history and sends for both members. A block permanently closes the pair's connection; removing the block does not restore it. Matching consent withdrawal followed by regrant does not restore an old pair's authorization. Profile visibility and eligibility changes deny connection access while ineligible. Previously seen content may already have been saved by a recipient.

The visible page rechecks every 10 seconds, hides fetched information when the tab becomes hidden, and clears it on denied/failed refresh or session change. These checks cannot erase screenshots, delivered responses, downloaded content, or information already seen.

Messages use a UUID v4 per logical send. Exact retries with the same sender, pair, UUID and normalized text return the same stored receipt. Reusing an ID with changed text returns 409. The API returns 50 newest messages in chronological order, with an opaque message cursor for older pages. Messages and photos are stored on the demo database; this is not end-to-end encrypted chat.

Account closure immediately denies access. During the existing signed matching minimization consumer, connection sharing/photos for affected pairs are removed and message bodies on those pairs are cleared. Message identity receipts remain restricted. Existing investigation holds and the closure policy/consumer prerequisites still apply. Backups follow the deployment's existing recovery controls; this feature does not promise immediate physical erasure.

## API documentation

Swagger at `/api/docs` documents all four new operations and their request examples:

- `GET /api/matches/connections/{connectionId}`
- `POST /api/matches/connections/{connectionId}/sharing`
- `GET /api/matches/connections/{connectionId}/messages?before=...`
- `POST /api/matches/connections/{connectionId}/messages`

`GET /api/matches/decisions` adds nullable `connectionId`. Only currently eligible mutual connections receive a reference. The complete document now has 75 operations.

## Updating the Windows demo

Keep the existing configured PowerShell windows. Stop the API and web processes with Ctrl+C. Keep Docker Desktop and the database running. From the repository root run:

```powershell
Set-Location "$HOME\Projects\vera-match-demo"
git pull --ff-only origin develop
npm.cmd ci
npm.cmd run prisma:generate
npx.cmd prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Run migrations in the configured API window, where `DATABASE_URL` still points to the intended demo database. Do not reset or recreate the database. Restart the API there with `npm.cmd run dev:api`. In the web window run `npm.cmd run build --workspace apps/web` followed by `npm.cmd run start --workspace apps/web`. Keep existing origin, SMTP, policy, staff and storage environment settings. No Tailscale change is needed.

To demonstrate, use two verified adult MEMBER accounts with visible profiles, matching consent and reciprocal preferences. Both Accept, refresh history, then each open their own connection link and save their sharing choices. A staff account cannot act as either member.

## Verification of this change

API and web production builds, TypeScript and Prisma schema validation passed. The API unit run passed 493 tests (4 existing tests skipped); 4 database lifecycle tests were excluded locally because the native Prisma engine download returns HTTP 403 in this workspace. Matching HTTP integration covered 31 cases against disposable PostgreSQL 18 schemas, including concurrent sharing, exact message retries, image disclosure, consent/session restrictions, blocking, pagination and a waiting send denied after chat withdrawal. These local database tests used the Prisma PostgreSQL driver adapter and applied the committed migration SQL; the normal native-engine CI path remains unchanged. Desktop/mobile browser checks passed all 20 selected cases, including accessibility checks of the connection page. Production dependency audit passed the high/critical threshold; existing moderate advisories remain.
