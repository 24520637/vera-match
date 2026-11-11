# Local setup and demonstration — not a production deployment guide

## Requirements

Node.js version in `.nvmrc` (24), npm, Docker Desktop/Compose, Git, and PowerShell or an equivalent shell.

### Windows PowerShell

```powershell
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
# Update the example passwords and the matching DATABASE_URL in both files.
docker compose --env-file .env -f infra/docker-compose.yml up -d
# Mailpit: http://localhost:8025
# MinIO Console: http://localhost:9001; create a private vera-private bucket.
npm install
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate
```

Open two terminals in the project root:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

## Local endpoints and limitations

- `http://localhost:4000/api/health`: basic API-process health, **not a database probe**.
- `http://localhost:3000`: **starter landing page only**. Login, expert operations, and matching are not yet wired up.
- `http://localhost:8025`: development mailbox (no real email delivery).
- `http://localhost:9001`: MinIO console (credentials from local `.env`).

The draft schema and full build/migration have not been confirmed to pass end-to-end. Fix observed errors before proceeding and record validation results accurately.

## Requirements before production

HTTPS; strong secrets and secret rotation; verified backups and recovery; privacy/legal retention and deletion rules; enforced MFA for staff; access reviews; threat modeling/penetration checks; security headers; private signed media URLs; production email service; rate limits; current CORS/cookie/CSRF configuration; and complete critical-path E2E evidence.
