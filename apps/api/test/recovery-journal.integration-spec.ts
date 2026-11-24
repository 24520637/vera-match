import { PrismaClient, ConsentPurpose } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { createAuthDatabase } from "./disposable-auth-database";
import { PrismaService } from "../src/database/prisma.service";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { ConsentService } from "../src/consent/consent.service";
import { ConsentPolicyRegistry, consentPurposes, PolicySnapshot } from "../src/consent/consent.policy";
import { SessionService } from "../src/auth/session.service";
import { hashSessionToken } from "../src/auth/session-token";
import { RecoveryJournalService } from "../src/recovery/recovery-journal.service";

const { initialize, JournalStore, createServer } = require("../../../ops/recovery-journal/server.cjs");
const { JournalClient } = require("../../../ops/recovery-journal/protocol.cjs");
class SyntheticPolicies extends ConsentPolicyRegistry {
  current(purpose: ConsentPurpose): PolicySnapshot {
    return { purpose, policyVersion: "synthetic-recovery-v1", locale: "en-test", testOnly: true, content: "SYNTHETIC RECOVERY TEST ONLY" };
  }
}

it("replays independently durable post-backup restrictions before access, with atomic receipts and no fake lifecycle completion", async () => {
  const source = await createAuthDatabase();
  const directory = mkdtempSync(join(tmpdir(), "vera-independent-journal-test-"));
  const journalId = randomUUID(), file = join(directory, "journal.jsonl");
  const keys = generateKeyPairSync("ed25519"), token = randomBytes(32).toString("base64url");
  initialize(file, journalId);
  const store = new JournalStore({ file, journalId, privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }) });
  const server = createServer(store, token);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new JournalClient({ origin: "http://127.0.0.1:" + server.address().port, token, journalId,
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" }), allowLocalHttp: true });
  const environment = { values: parseEnvironment({ ...process.env, NODE_ENV: "test", DATABASE_URL: source.url,
    MINIO_ROOT_USER: "synthetic-test", MINIO_ROOT_PASSWORD: "synthetic-test-only" }) } as EnvironmentService;
  const makeJournal = (db: PrismaClient, ready: boolean) => {
    const service = new RecoveryJournalService(db as PrismaService, environment);
    // Explicit isolated test fixture; no production environment flag installs it.
    Object.assign(service, { enabled: true, client, ready }); return service;
  };
  const sourceJournal = makeJournal(source.client, true);
  const sourceConsent = new ConsentService(source.client as PrismaService, new SyntheticPolicies(), environment, sourceJournal);
  const targetName = "vera_recovery_journal_" + randomUUID().replaceAll("-", "");
  const configured = new URL(source.url), targetUrl = new URL(source.url); targetUrl.pathname = "/" + targetName;
  const pgBin = process.env.C095_PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "/usr/lib/postgresql/18/bin");
  const childEnv = { ...process.env, PGHOST: configured.hostname, PGPORT: "5433", PGUSER: decodeURIComponent(configured.username),
    PGPASSWORD: decodeURIComponent(configured.password), PGDATABASE: decodeURIComponent(configured.pathname.slice(1)), PGCONNECT_TIMEOUT: "5" };
  const command = (name: string, args: string[], database = childEnv.PGDATABASE) => execFileSync(join(pgBin, name + (process.platform === "win32" ? ".exe" : "")), args,
    { env: { ...childEnv, PGDATABASE: database }, windowsHide: true, stdio: "pipe", timeout: 30000 });
  let target: PrismaClient | undefined, created = false;
  try {
    expect(source.schema).toMatch(/^vera_auth_test_[a-f0-9]{32}$/);
    const sessionToken = randomBytes(32).toString("base64url");
    const user = await source.client.user.create({ data: { email: randomUUID() + "@example.invalid", passwordHash: "synthetic-unused",
      role: "MEMBER", status: "ACTIVE", emailVerifiedAt: new Date(), sessions: { create: {
        tokenHash: hashSessionToken(sessionToken), expiresAt: new Date(Date.now() + 600000) } } } });
    await sourceConsent.patch(user.id, { expectedVersion: 0,
      consents: consentPurposes.map(purpose => ({ purpose, granted: true, policyVersion: "synthetic-recovery-v1" })) }, randomUUID());
    const preBindingArchive = join(directory, "synthetic-before-journal-binding.dump");
    command("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--schema", source.schema, "--file", preBindingArchive]);
    const unbound = makeJournal(source.client, false);
    await expect(unbound.recoverBeforeListening(sourceConsent)).rejects.toThrow("RECOVERY_RECONCILIATION_REQUIRED");
    expect(() => unbound.assertReady()).toThrow();
    await sourceJournal.initializeDatabaseBinding();
    await sourceJournal.recoverBeforeListening(sourceConsent);
    await expect(makeJournal(source.client, false).initializeDatabaseBinding()).rejects.toThrow("NEW_UNBOUND_JOURNAL");
    const archive = join(directory, "synthetic-pre-restriction.dump");
    command("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--schema", source.schema, "--file", archive]);
    await sourceConsent.patch(user.id, { expectedVersion: 1, consents: [{ purpose: "PROFILE_MATCHING", granted: false }] }, randomUUID());
    expect(await source.client.recoveryJournalReceipt.count()).toBe(2);
    expect(store.entries).toHaveLength(2);
    created = true;
    await source.client.$executeRawUnsafe('CREATE DATABASE "' + targetName + '" TEMPLATE template0');
    command("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname", targetName, archive], targetName);
    target = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } }, log: [] });
    const restoredSessions = new SessionService(target as PrismaService);
    expect(await restoredSessions.resolve(sessionToken)).not.toBeNull(); // actual old-backup negative control
    expect(await target.consent.count({ where: { userId: user.id, granted: true } })).toBe(5);
    const recoveredJournal = makeJournal(target, false);
    expect(() => recoveredJournal.assertReady()).toThrow();
    const recoveredConsents = new ConsentService(target as PrismaService, new SyntheticPolicies(), environment, recoveredJournal);
    await recoveredJournal.recoverBeforeListening(recoveredConsents);
    expect(() => recoveredJournal.assertReady()).not.toThrow();
    expect(await restoredSessions.resolve(sessionToken)).toBeNull();
    expect((await target.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("SUSPENDED");
    expect(await target.consent.count({ where: { userId: user.id, granted: true } })).toBe(0);
    expect(await target.consentWithdrawalTask.count()).toBe(5);
    expect(await target.recoveryJournalReceipt.findFirst({ where: { disposition: "QUARANTINED" } })).toMatchObject({ journalId, disposition: "QUARANTINED" });
    expect(await target.accountClosure.count()).toBe(0); // no invented closure or erasure receipts
    await recoveredJournal.recoverBeforeListening(recoveredConsents);
    expect(await target.consentWithdrawalTask.count()).toBe(5);
    await expect(target.recoveryJournalReceipt.deleteMany()).rejects.toThrow("RECOVERY_RECEIPT_IMMUTABLE");
    // A durable PREPARED record survives rollback of the main database mutation.
    await expect(source.client.$transaction(async tx => {
      await sourceJournal.record(tx, [user.id], "ACCOUNT_CLOSURE"); throw new Error("synthetic database rollback");
    })).rejects.toThrow("synthetic database rollback");
    expect(store.entries).toHaveLength(3);
    expect(await source.client.recoveryJournalReceipt.count()).toBe(2);
    await sourceJournal.recoverBeforeListening(sourceConsent);
    expect((await source.client.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("SUSPENDED");
    expect(await source.client.recoveryJournalReceipt.count({ where: { disposition: "QUARANTINED" } })).toBe(1);
    // A genuinely restored backup predating the independently journaled binding
    // must not be mistaken for a fresh database and automatically initialized.
    await target.$disconnect();
    await source.client.$executeRawUnsafe('DROP DATABASE "' + targetName + '"');
    await source.client.$executeRawUnsafe('CREATE DATABASE "' + targetName + '" TEMPLATE template0');
    command("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname", targetName, preBindingArchive], targetName);
    target = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } }, log: [] });
    expect(await new SessionService(target as PrismaService).resolve(sessionToken)).not.toBeNull();
    const tooOld = makeJournal(target, false);
    await expect(tooOld.recoverBeforeListening(new ConsentService(target as PrismaService, new SyntheticPolicies(), environment, tooOld)))
      .rejects.toThrow("RECOVERY_RECONCILIATION_REQUIRED");
    expect(() => tooOld.assertReady()).toThrow();
    await expect(makeJournal(target, false).initializeDatabaseBinding()).rejects.toThrow("NEW_UNBOUND_JOURNAL");
    // Missing transport closes the ordinary request fence; no success is asserted.
    server.closeAllConnections(); await new Promise<void>(r => server.close(r));
    await expect(source.client.$transaction(tx => sourceJournal.record(tx, [user.id], "SESSION_REVOCATION"))).rejects.toThrow();
    expect(() => sourceJournal.assertReady()).toThrow();
    const probeJournal = makeJournal(source.client, true);
    await expect(probeJournal.verifyAvailability()).rejects.toThrow();
    expect(() => probeJournal.assertReady()).toThrow();
  } finally {
    server.closeAllConnections(); if (server.listening) await new Promise<void>(r => server.close(r)); store.close();
    await target?.$disconnect();
    if (created) { if (!/^vera_recovery_journal_[a-f0-9]{32}$/.test(targetName)) throw Error("Unsafe test target");
      await source.client.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + targetName + '"'); }
    await source.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.includes("vera-independent-journal-test-")) throw Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
}, 120000);
