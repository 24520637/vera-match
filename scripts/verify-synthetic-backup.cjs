// C095 rehearsal: only fresh, nonce-owned databases; never dump the configured database.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const root = path.resolve(__dirname, "..");
for (const file of ["apps/api/.env", ".env"]) {
  try { process.loadEnvFile(path.join(root, file)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const runId = randomUUID(), nonce = runId.replaceAll("-", "");
const names = ["vera_c095_" + nonce + "_src", "vera_c095_" + nonce + "_dst"];
const ownedName = name => names.includes(name) && /^vera_c095_[a-f0-9]{32}_(src|dst)$/.test(name);
let stage = "PREFLIGHT";
function command(exe, args, env) {
  return execFileSync(exe, args, { env, windowsHide: true, encoding: "utf8", stdio: "pipe", timeout: 120000 });
}
async function catalog(client) {
  const foreignKeys = await client.$queryRawUnsafe(`SELECT c.conname AS name, s.relname AS child, t.relname AS parent,
    pg_get_constraintdef(c.oid) AS definition,
    CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT'
      WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END AS "deleteAction"
    FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_class t ON t.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=s.relnamespace WHERE c.contype='f' AND n.nspname='public'
    ORDER BY s.relname,c.conname`);
  const triggers = await client.$queryRawUnsafe(`SELECT c.relname AS "table", t.tgname AS name,
    pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname`);
  return { foreignKeys, triggers };
}
async function verify() {
  const configured = new URL(process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname) || configured.port !== "5433")
    throw new Error("Loopback PostgreSQL 18 required");
  const admin = new PrismaClient({ datasources: { db: { url: configured.toString() } }, log: [] });
  const created = [], clients = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vera-c095-"));
  fs.chmodSync(dir, 0o700);
  const archive = path.join(dir, "synthetic.dump");
  const bin = process.env.C095_PG_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "/usr/lib/postgresql/18/bin");
  const executable = name => path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
  const urlFor = name => { if (!ownedName(name)) throw new Error("Owned database required");
    const url = new URL(configured); url.pathname = "/" + name; url.searchParams.set("schema", "public"); return url.toString(); };
  const pgEnv = name => ({ ...process.env, PGHOST: configured.hostname.replace(/^\[|\]$/g, ""), PGPORT: "5433",
    PGUSER: decodeURIComponent(configured.username), PGPASSWORD: decodeURIComponent(configured.password),
    PGDATABASE: name, PGCONNECT_TIMEOUT: "5" });
  let cleanupOk = false;
  try {
    const [server] = await admin.$queryRawUnsafe("SELECT current_setting('server_version_num')::int AS version, (SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname=current_user) AS allowed");
    if (server.version < 180000 || server.version >= 190000 || !server.allowed) throw new Error("PostgreSQL 18 disposable database creation permission required");
    if (!/\b18\./.test(command(executable("pg_dump"), ["--version"], process.env))) throw new Error("Matching pg_dump 18 required");
    fs.writeFileSync(path.join(dir, "owned-resources.json"), JSON.stringify({ kind: "vera-c095-disposable", runId, databases: names }), { flag: "wx", mode: 0o600 });
    for (const name of names) {
      if (!ownedName(name) || name === decodeURIComponent(configured.pathname.slice(1))) throw new Error("Configured database refused");
      if ((await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname=$1", name)).length) throw new Error("Fixture database already exists; refusing reuse");
      created.push(name); // Also reconcile an uncertain CREATE acknowledgement, using this run's fresh nonce only.
      await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '" TEMPLATE template0');
    }
    stage = "MIGRATE_SYNTHETIC_SOURCE";
    command(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(root, "apps/api/prisma/schema.prisma")],
      { ...process.env, DATABASE_URL: urlFor(names[0]) });
    const source = new PrismaClient({ datasources: { db: { url: urlFor(names[0]) } }, log: [] }); clients.push(source);
    const target = new PrismaClient({ datasources: { db: { url: urlFor(names[1]) } }, log: [] }); clients.push(target);
    const user = await source.user.create({ data: { email: runId + "@backup.example.invalid", passwordHash: "synthetic-not-a-login-hash",
      profile: { create: { bio: "C095 synthetic restore canary" } } } });
    const audit = await source.auditLog.create({ data: { actorId: user.id, action: "SAFETY_C095_BACKUP_FIXTURE", subjectType: "SyntheticFixture" } });
    const original = await catalog(source);
    stage = "BACKUP_SYNTHETIC_SOURCE";
    command(executable("pg_dump"), ["--format=custom", "--no-owner", "--no-acl", "--file", archive], pgEnv(names[0]));
    fs.chmodSync(archive, 0o600);
    stage = "RESTORE_FRESH_SYNTHETIC_TARGET";
    command(executable("pg_restore"), ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname", names[1], archive], pgEnv(names[1]));
    stage = "VERIFY_RESTORED_DATA";
    const restored = await target.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } });
    if (restored.email !== user.email || restored.status !== "PENDING_EMAIL" || restored.profile?.bio !== "C095 synthetic restore canary")
      throw new Error("Restored synthetic data mismatch");
    stage = "VERIFY_MIGRATION_HISTORY";
    const [migrations] = await target.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    const expected = fs.readdirSync(path.join(root, "apps/api/prisma/migrations"), { withFileTypes: true }).filter(e => e.isDirectory()).length;
    if (migrations.count !== expected) throw new Error("Migration history mismatch");
    stage = "VERIFY_CATALOG";
    if (JSON.stringify(await catalog(target)) !== JSON.stringify(original)) throw new Error("Foreign key / trigger catalog mismatch");
    stage = "VERIFY_FOREIGN_KEY_AND_SAFETY_AUDIT";
    let foreignKeyRejected = false, immutableRejected = false;
    try { await target.profile.create({ data: { userId: "c095-missing-user" } }); }
    catch (error) { foreignKeyRejected = error.code === "P2003"; }
    try { await target.auditLog.delete({ where: { id: audit.id } }); }
    catch { immutableRejected = true; }
    if (!foreignKeyRejected || !immutableRejected || await target.auditLog.count({ where: { id: audit.id } }) !== 1)
      throw new Error("Restored integrity protection failed");
    const result = { kind: "vera-c095-evidence", runId, serverMajor: 18, migrations: migrations.count,
      dataRestored: true, foreignKeyRejected, immutableRejected, catalog: original,
      catalogSha256: createHash("sha256").update(JSON.stringify(original)).digest("hex") };
    stage = "COMPLETE";
    return result;
  } finally {
    await Promise.all(clients.map(client => client.$disconnect()));
    try {
      for (const name of [...created].reverse()) {
        if (!ownedName(name)) throw new Error("Unknown database cleanup refused");
        await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '"');
      }
      cleanupOk = true;
    } finally {
      await admin.$disconnect();
      if (cleanupOk) {
        const target = fs.realpathSync(dir), parent = fs.realpathSync(os.tmpdir());
        if (path.dirname(target) !== parent || !path.basename(target).startsWith("vera-c095-")) throw new Error("Unsafe archive cleanup refused");
        fs.rmSync(target, { recursive: true, force: true });
      } else console.error("C095 owned fixture cleanup incomplete; inspect its owned-resources.json before recovery.");
    }
  }
}
verify().then(result => {
  result.disposableResourcesRemoved = true;
  if (process.env.C095_EVIDENCE_DIR) {
    const dir = path.resolve(process.env.C095_EVIDENCE_DIR);
    if (!fs.statSync(dir).isDirectory()) throw new Error("Existing evidence directory required");
    fs.writeFileSync(path.join(dir, "c095-" + runId + ".json"), JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  }
  console.log("PASS C095 synthetic backup/restore: migrations=" + result.migrations + ", foreignKeys=" + result.catalog.foreignKeys.length +
    ", triggers=" + result.catalog.triggers.length + "; owned databases/archive removed.");
}).catch(() => { console.error("C095 synthetic backup/restore failed at " + stage + "; inspect prerequisites/owned fixture state, not shared data."); process.exitCode = 1; });
