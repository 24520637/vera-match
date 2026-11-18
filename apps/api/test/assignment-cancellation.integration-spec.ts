import {
  AssignmentCancellationService,
  CANCELLATION_SYSTEM_ACTOR,
} from "../src/assignment-cancellation/assignment-cancellation.service";
import { AssignmentCancellationWorker } from "../src/assignment-cancellation/assignment-cancellation.worker";
import { ExpertMfaSource } from "../src/expert-admin/expert-mfa.source";
import { PrivateStorageService } from "../src/video/private-storage.service";
import { INestApplication, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { hashSessionToken } from "../src/auth/session-token";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { ConsentService } from "../src/consent/consent.service";
import { ConsentPolicyRegistry } from "../src/consent/consent.policy";
import {
  ExpertApprovalRegistry,
  ExpertEvidenceSource,
  ExpertEvidence,
} from "../src/expert-admin/expert-approval.sources";
import { createAuthDatabase } from "./disposable-auth-database";
import { transition, assignmentEvent } from "./expert-db-fixtures";

describe("C051 assignment cancellation / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>,
    app: INestApplication,
    base: string;
  let records: Map<string, ExpertEvidence>,
    policyVersion: string,
    testOnly: boolean;
  const origin = "http://localhost:3000",
    trainingVersion = "synthetic-training-v1",
    confidentialityVersion = "synthetic-confidentiality-v1";
  beforeAll(async () => {
    db = await createAuthDatabase();
  }, 60000);
  beforeEach(async () => {
    if (
      process.env.NODE_ENV !== "test" ||
      !/^vera_auth_test_[a-f0-9]{32}$/.test(db.schema)
    )
      throw new Error("Disposable test schema required");
    records = new Map();
    policyVersion = `synthetic-${randomUUID()}`;
    testOnly = true;
    const values = parseEnvironment({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      CORS_ORIGIN: origin,
      MINIO_ROOT_USER: "synthetic-test",
      MINIO_ROOT_PASSWORD: "synthetic-test-only",
      MINIO_BUCKET: "synthetic-private",
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService)
      .useValue({ values })
      .overrideProvider(PrismaService)
      .useValue(db.client)
      .overrideProvider(ExpertMfaSource)
      .useValue({
        resolve: async (auth: { sessionId: string; user: { id: string } }) => ({
          userId: auth.user.id,
          sessionId: auth.sessionId,
          expiresAt: new Date(Date.now() + 600000),
          testOnly: true,
        }),
      })
      .overrideProvider(ConsentPolicyRegistry)
      .useValue({
        current: (purpose: string) => ({
          purpose,
          policyVersion,
          locale: "en",
          content: `SYNTHETIC ${purpose} POLICY`,
          testOnly,
        }),
      })
      .overrideProvider(ExpertApprovalRegistry)
      .useValue({
        training: (version: string) =>
          version === trainingVersion
            ? { version, content: "SYNTHETIC TRAINING" }
            : undefined,
        confidentiality: (version: string) =>
          version === confidentialityVersion
            ? { version, content: "SYNTHETIC CONFIDENTIALITY" }
            : undefined,
      })
      .overrideProvider(ExpertEvidenceSource)
      .useValue({ find: async (id: string) => records.get(id) })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    // Real SigV4 presigner, synthetic credentials; bucket HTTP checks need MinIO and
    // are separately covered by the existing real-storage suite when available.
    jest
      .spyOn(app.get(PrivateStorageService), "assertPrivate")
      .mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(async () => {
    await db?.close();
  });
  async function user(
    role: UserRole,
    status: AccountStatus = AccountStatus.ACTIVE,
    verified = true,
  ) {
    const token = randomBytes(32).toString("base64url");
    const row = await db.client.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: "synthetic-only",
        role,
        status,
        emailVerifiedAt: verified ? new Date() : null,
        sessions: {
          create: {
            tokenHash: hashSessionToken(token),
            expiresAt: new Date(Date.now() + 600000),
          },
        },
      },
    });
    return {
      ...row,
      cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}`,
    };
  }
  const request = (
    cookie: string,
    body: unknown,
    key: string = randomUUID(),
    headers: Record<string, string> = {},
    path = "assignments",
  ) =>
    fetch(`${base}/api/expert-admin/${path}`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  async function patchConsent(
    id: string,
    version: number,
    purpose: "VIDEO_STORAGE" | "EXPERT_VIDEO_REVIEW",
    granted: boolean,
  ) {
    return app.get(ConsentService).patch(
      id,
      {
        expectedVersion: version,
        consents: [{ purpose, granted, ...(granted ? { policyVersion } : {}) }],
      },
      randomUUID(),
    );
  }
  async function fixture(
    expiry: string | null = null,
    evidenceExpiry: Date | null = null,
  ) {
    const moderator = await user("MODERATOR"),
      owner = await user("MEMBER"),
      expert = await user("EXPERT");
    const trainingEvidenceId = randomUUID(),
      confidentialityEvidenceId = randomUUID();
    for (const [id, kind, version] of [
      [trainingEvidenceId, "TRAINING_COMPLETION", trainingVersion],
      [
        confidentialityEvidenceId,
        "CONFIDENTIALITY_ACCEPTANCE",
        confidentialityVersion,
      ],
    ] as const)
      records.set(id, {
        id,
        kind,
        version,
        userId: expert.id,
        content: `SYNTHETIC ${kind} RECORD`,
        recordedAt: new Date("2026-01-01"),
        validUntil: evidenceExpiry,
      });
    const approved = await request(
      moderator.cookie,
      {
        expectedRevision: 0,
        trainingVersion,
        policyVersion: confidentialityVersion,
        trainingEvidenceId,
        confidentialityEvidenceId,
        expiresAt: expiry,
      },
      randomUUID(),
      {},
      `experts/${expert.id}/approvals`,
    );
    expect(approved.status).toBe(201);
    await app.get(ConsentService).patch(
      owner.id,
      {
        expectedVersion: 0,
        consents: [
          { purpose: "VIDEO_STORAGE", granted: true, policyVersion },
          { purpose: "EXPERT_VIDEO_REVIEW", granted: true, policyVersion },
        ],
      },
      randomUUID(),
    );
    const video = await db.client.video.create({
      data: {
        ownerId: owner.id,
        bucket: "synthetic-private",
        objectKey: randomUUID(),
        mimeType: "video/mp4",
        status: "READY",
        storageConsentVersion: 1n,
      },
    });
    const body: {
      videoId: string;
      expertId: string;
      expectedCredentialRevision: number;
      dueAt: string | null;
      expiresAt: string | null;
    } = {
      videoId: video.id,
      expertId: expert.id,
      expectedCredentialRevision: 1,
      dueAt: null,
      expiresAt: null,
    };
    return {
      moderator,
      owner,
      expert,
      video,
      body,
      trainingEvidenceId,
      confidentialityEvidenceId,
    };
  }
  async function create(
    seed: Awaited<ReturnType<typeof fixture>>,
    key = randomUUID(),
  ) {
    const response = await request(seed.moderator.cookie, seed.body, key);
    expect(response.status).toBe(201);
    return (await response.json()) as {
      assignment: { id: string; status: string; revision: number };
    };
  }
  const cancellation = () => app.get(AssignmentCancellationService);
  const worker = () => app.get(AssignmentCancellationWorker);
  async function withdrawal(
    seed: Awaited<ReturnType<typeof fixture>>,
    purpose: "VIDEO_STORAGE" | "EXPERT_VIDEO_REVIEW",
  ) {
    await patchConsent(seed.owner.id, 1, purpose, false);
    const ledger = await db.client.consentLedger.findUniqueOrThrow({
      where: { userId: seed.owner.id },
    });
    return db.client.consentWithdrawalTask.findFirstOrThrow({
      where: { subjectId: ledger.subjectId, purpose, version: 2n },
    });
  }
  const remove = (cookie: string, id: string) =>
    fetch(base + "/api/videos/" + id, {
      method: "DELETE",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  test("persistently failing backlog emits private aggregate alerts across restart and UTC+7, then clears on real recovery", async () => {
    const a = await fixture(),
      aa = await create(a),
      task = await withdrawal(a, "EXPERT_VIDEO_REVIEW"),
      b = await fixture(),
      ba = await create(b),
      aged = new Date(Date.now() - 1200000);
    await db.client.consentWithdrawalTask.update({
      where: { id: task.id },
      data: { createdAt: aged },
    });
    await db.client.video.update({
      where: { id: b.video.id },
      data: { status: "DELETED", deletedAt: aged },
    });
    const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined),
      log = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);
    await db.client
      .$executeRawUnsafe(`CREATE FUNCTION c051_observation_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='ASSIGNMENT_PRIVACY_CANCELLED' THEN RAISE EXCEPTION 'PRIVATE SQL or media payload'; END IF; RETURN NEW; END $$`);
    await db.client.$executeRawUnsafe(
      'CREATE TRIGGER c051_observation_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c051_observation_fail()',
    );
    try {
      await worker().runOnce();
      await new AssignmentCancellationWorker(
        db.client as unknown as PrismaService,
        cancellation(),
        app.get(EnvironmentService),
      ).runOnce();
      // Legacy missing deletion dates use a conservative durable creation age.
      await db.client.video.update({
        where: { id: b.video.id },
        data: { deletedAt: null, createdAt: aged },
      });
      await db.client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Bangkok'");
        const observer = new AssignmentCancellationWorker(
          tx as unknown as PrismaService,
          cancellation(),
          app.get(EnvironmentService),
        ) as unknown as { observeBacklog(): Promise<void> };
        await observer.observeBacklog();
      });
      const alerts = warn.mock.calls
        .map((c) => c[0])
        .filter((c) => typeof c === "object");
      expect(alerts).toHaveLength(6);
      for (const alert of alerts)
        expect(alert).toEqual({
          code: "ASSIGNMENT_CANCELLATION_BACKLOG_OVERDUE",
          lane: expect.stringMatching(/^(withdrawal|deleted-video)$/),
          pending: 1,
          oldestSeconds: expect.any(Number),
          thresholdSeconds: 900,
        });
      for (const alert of alerts)
        expect(
          (alert as { oldestSeconds: number }).oldestSeconds,
        ).toBeGreaterThanOrEqual(1200);
      for (const call of log.mock.calls)
        expect(call[0]).toMatchObject({
          code: "ASSIGNMENT_CANCELLATION_HEARTBEAT",
          withdrawalPending: 1,
          deletedVideoPending: 1,
        });
      expect(
        JSON.stringify([...log.mock.calls, ...warn.mock.calls]),
      ).not.toMatch(
        new RegExp([task.id, a.owner.id, b.video.id, "PRIVATE"].join("|")),
      );
      expect(
        await db.client.assignmentWithdrawalReceipt.findUnique({
          where: { withdrawalTaskId: task.id },
        }),
      ).toBeNull();
    } finally {
      await db.client.$executeRawUnsafe(
        'DROP TRIGGER c051_observation_fail ON "AuditLog"',
      );
      await db.client.$executeRawUnsafe(
        "DROP FUNCTION c051_observation_fail()",
      );
      warn.mockClear();
      log.mockClear();
    }
    try {
      await worker().runOnce();
      expect(log.mock.calls).toEqual([
        [
          {
            code: "ASSIGNMENT_CANCELLATION_HEARTBEAT",
            withdrawalPending: 0,
            withdrawalOldestSeconds: 0,
            deletedVideoPending: 0,
            deletedVideoOldestSeconds: 0,
          },
        ],
      ]);
      expect(warn).not.toHaveBeenCalled();
      expect(
        await db.client.expertAssignment.count({
          where: {
            id: { in: [aa.assignment.id, ba.assignment.id] },
            status: "CANCELLED",
            revision: 1n,
          },
        }),
      ).toBe(2);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });
  test.each(["withdrawal", "deleted-video"] as const)(
    "%s scan passes 25 persistent failures, survives worker restart and retries safely",
    async (lane) => {
      const items: { id: string; assignmentId: string }[] = [];
      for (let i = 0; i < 28; i++) {
        const seed = await fixture(),
          created = await create(seed);
        if (lane === "withdrawal") {
          const task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
          items.push({ id: task.id, assignmentId: created.assignment.id });
        } else {
          await db.client.video.update({
            where: { id: seed.video.id },
            data: { status: "DELETED", deletedAt: new Date() },
          });
          items.push({
            id: seed.video.id,
            assignmentId: created.assignment.id,
          });
        }
      }
      // Include both old createdAt ordering and the durable ID ordering: only
      // the last three under either order can succeed during fault injection.
      const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));
      const failed = ordered.slice(0, 25);
      if (lane === "withdrawal")
        for (const item of failed)
          await db.client.consentWithdrawalTask.update({
            where: { id: item.id },
            data: { createdAt: new Date("2020-01-01") },
          });
      await db.client.$executeRawUnsafe(
        "CREATE TABLE c051_poison (id text PRIMARY KEY)",
      );
      for (const item of failed)
        await db.client
          .$executeRaw`INSERT INTO c051_poison VALUES (${item.assignmentId})`;
      await db.client
        .$executeRawUnsafe(`CREATE FUNCTION c051_poison_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action='ASSIGNMENT_PRIVACY_CANCELLED' AND EXISTS (
          SELECT 1 FROM "AssignmentEvent" e JOIN c051_poison p ON p.id=e."assignmentId"
          WHERE e.id::text=NEW."subjectId") THEN RAISE EXCEPTION 'synthetic persistent audit failure'; END IF;
        RETURN NEW; END $$`);
      await db.client.$executeRawUnsafe(
        'CREATE TRIGGER c051_poison_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c051_poison_audit()',
      );
      const freshWorker = () =>
        new AssignmentCancellationWorker(
          db.client as unknown as PrismaService,
          cancellation(),
          app.get(EnvironmentService),
        );
      try {
        // A fresh instance for each scan rules out process-local fairness state.
        // Concurrent scans use the same durable database scheduling state.
        for (let i = 0; i < 3; i++)
          await Promise.all([freshWorker().runOnce(), freshWorker().runOnce()]);
        expect(
          await db.client.expertAssignment.count({
            where: {
              id: { in: ordered.slice(25).map((i) => i.assignmentId) },
              status: "CANCELLED",
            },
          }),
        ).toBe(3);
        expect(
          await db.client.expertAssignment.count({
            where: {
              id: { in: failed.map((i) => i.assignmentId) },
              status: "ASSIGNED",
              revision: 0n,
            },
          }),
        ).toBe(25);
        expect(
          await db.client.assignmentCancellationContext.count({
            where: {
              event: {
                assignmentId: { in: failed.map((i) => i.assignmentId) },
              },
            },
          }),
        ).toBe(0);
        if (lane === "withdrawal")
          expect(
            await db.client.assignmentWithdrawalReceipt.count({
              where: { withdrawalTaskId: { in: failed.map((i) => i.id) } },
            }),
          ).toBe(0);
      } finally {
        await db.client.$executeRawUnsafe(
          'DROP TRIGGER c051_poison_audit ON "AuditLog"',
        );
        await db.client.$executeRawUnsafe("DROP FUNCTION c051_poison_audit()");
        await db.client.$executeRawUnsafe("DROP TABLE c051_poison");
      }
      for (let i = 0; i < 4; i++)
        await Promise.all([freshWorker().runOnce(), freshWorker().runOnce()]);
      for (const item of items) {
        expect(
          await db.client.expertAssignment.findUnique({
            where: { id: item.assignmentId },
          }),
        ).toMatchObject({ status: "CANCELLED", revision: 1n });
        expect(
          await db.client.assignmentEvent.count({
            where: { assignmentId: item.assignmentId, toStatus: "CANCELLED" },
          }),
        ).toBe(1);
        expect(
          await db.client.assignmentCancellationContext.count({
            where: { event: { assignmentId: item.assignmentId } },
          }),
        ).toBe(1);
        if (lane === "withdrawal")
          expect(
            await db.client.assignmentWithdrawalReceipt.findUnique({
              where: { withdrawalTaskId: item.id },
            }),
          ).not.toBeNull();
      }
    },
    90000,
  );
  test("persisted lap bounds survive skipped batches, new arrivals and failed cursor commits", async () => {
    const seed = await fixture();
    const ids: string[] = [];
    const credential = await db.client.expertCredential.findUniqueOrThrow({
      where: { userId: seed.expert.id },
    });
    async function add(index: number) {
      const id =
        "zz-c051-" + String(index).padStart(3, "0") + "-" + randomUUID();
      await db.client.video.create({
        data: {
          id,
          ownerId: seed.owner.id,
          bucket: "synthetic-private",
          objectKey: randomUUID(),
          mimeType: "video/mp4",
          status: "DELETED",
          deletedAt: new Date(),
        },
      });
      await db.client.$transaction(async (tx) => {
        const row = await tx.expertAssignment.create({
          data: {
            videoId: id,
            expertId: seed.expert.id,
            assignedByEvidence: { subject: "synthetic-moderator" },
            credentialApprovalId: credential.approvalId,
          },
        });
        await assignmentEvent(tx, row.id, null);
      });
      ids.push(id);
      return id;
    }
    for (let i = 0; i < 22; i++) await add(i);
    const reserve = () =>
      new AssignmentCancellationWorker(
        db.client as unknown as PrismaService,
        cancellation(),
        app.get(EnvironmentService),
      ) as unknown as {
        nextBatch(lane: "deleted-video"): Promise<{ id: string }[]>;
      };
    // Persist selection, then abandon processing as if this worker had crashed.
    expect(
      (await reserve().nextBatch("deleted-video")).map((r) => r.id),
    ).toEqual(ids.slice(0, 20));
    const cursor = await db.client.assignmentCancellationScan.findUniqueOrThrow(
      { where: { lane: "deleted-video" } },
    );
    expect(cursor.throughId).toBe(ids[21]);
    await add(22);
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION c051_scan_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cursor write failure'; END $$`,
    );
    await db.client.$executeRawUnsafe(
      'CREATE TRIGGER c051_scan_commit_fail BEFORE UPDATE ON "AssignmentCancellationScan" FOR EACH ROW EXECUTE FUNCTION c051_scan_commit_fail()',
    );
    try {
      await expect(reserve().nextBatch("deleted-video")).rejects.toThrow();
      expect(
        await db.client.assignmentCancellationScan.findUnique({
          where: { lane: "deleted-video" },
        }),
      ).toEqual(cursor);
    } finally {
      await db.client.$executeRawUnsafe(
        'DROP TRIGGER c051_scan_commit_fail ON "AssignmentCancellationScan"',
      );
      await db.client.$executeRawUnsafe(
        "DROP FUNCTION c051_scan_commit_fail()",
      );
    }
    expect(
      (await reserve().nextBatch("deleted-video")).map((r) => r.id),
    ).toEqual(ids.slice(20, 22));
    // New arrivals did not extend the old lap; abandoned first-page work returns.
    expect(
      (await reserve().nextBatch("deleted-video")).map((r) => r.id),
    ).toEqual(ids.slice(0, 20));
    for (let i = 0; i < 3; i++) await worker().runOnce();
    expect(
      await db.client.expertAssignment.count({
        where: { videoId: { in: ids }, status: "CANCELLED", revision: 1n },
      }),
    ).toBe(23);
  });
  test.each(["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] as const)(
    "owner DELETE cancels %s exactly once with retained owner evidence",
    async (status) => {
      const seed = await fixture(),
        created = await create(seed),
        id = created.assignment.id;
      if (status !== "ASSIGNED")
        await transition(db.client, id, 0n, "IN_PROGRESS");
      if (status === "SUBMITTED")
        await transition(db.client, id, 1n, "SUBMITTED");
      const before = await db.client.expertAssignment.findUniqueOrThrow({
        where: { id },
      });
      expect((await remove(seed.owner.cookie, seed.video.id)).status).toBe(202);
      expect((await remove(seed.owner.cookie, seed.video.id)).status).toBe(202);
      const after = await db.client.expertAssignment.findUniqueOrThrow({
        where: { id },
      });
      expect(after).toMatchObject({
        status: "CANCELLED",
        revision: before.revision + 1n,
        credentialApprovalId: before.credentialApprovalId,
        reviewConsentSubjectId: before.reviewConsentSubjectId,
        reviewConsentVersion: before.reviewConsentVersion,
        assignedByEvidence: before.assignedByEvidence,
      });
      const events = await db.client.assignmentEvent.findMany({
        where: { assignmentId: id, toStatus: "CANCELLED" },
      });
      expect(events).toHaveLength(1);
      const actor = await db.client.expertActorIdentity.findUniqueOrThrow({
        where: { userId: seed.owner.id },
      });
      expect(events[0].actorEvidence).toEqual({ subject: actor.subjectId });
      expect(
        await db.client.assignmentCancellationContext.findUnique({
          where: { eventId: events[0].id },
        }),
      ).toMatchObject({
        reason: "VIDEO_DELETED",
        sourceTaskId: null,
        initiatorEvidence: { kind: "ACCOUNT", subject: actor.subjectId },
      });
      expect(
        await db.client.videoCleanupTask.findUnique({
          where: { videoId: seed.video.id },
        }),
      ).toMatchObject({ status: "PENDING", removeFinal: true });
    },
  );
  test.each(["CANCELLED", "COMPLETED"] as const)(
    "owner DELETE preserves terminal %s and old evidence",
    async (status) => {
      const seed = await fixture(),
        created = await create(seed),
        id = created.assignment.id;
      if (status === "CANCELLED") await transition(db.client, id, 0n, status);
      else {
        await transition(db.client, id, 0n, "IN_PROGRESS");
        await transition(db.client, id, 1n, "SUBMITTED");
        await transition(db.client, id, 2n, "COMPLETED");
      }
      const before = await db.client.expertAssignment.findUniqueOrThrow({
          where: { id },
        }),
        events = await db.client.assignmentEvent.findMany({
          where: { assignmentId: id },
        });
      expect((await remove(seed.owner.cookie, seed.video.id)).status).toBe(202);
      expect(
        await db.client.expertAssignment.findUnique({ where: { id } }),
      ).toEqual(before);
      expect(
        await db.client.assignmentEvent.findMany({
          where: { assignmentId: id },
        }),
      ).toEqual(events);
      expect(
        await db.client.assignmentCancellationContext.count({
          where: { event: { assignmentId: id } },
        }),
      ).toBe(0);
    },
  );
  test.each(["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"] as const)(
    "%s worker is source-bound and never completes the shared task",
    async (purpose) => {
      const seed = await fixture(),
        created = await create(seed),
        task = await withdrawal(seed, purpose);
      expect((await cancellation().processWithdrawal(task.id)).cancelled).toBe(
        1,
      );
      expect((await cancellation().processWithdrawal(task.id)).cancelled).toBe(
        0,
      );
      expect(
        await db.client.expertAssignment.findUnique({
          where: { id: created.assignment.id },
        }),
      ).toMatchObject({ status: "CANCELLED", revision: 1n });
      const event = await db.client.assignmentEvent.findFirstOrThrow({
        where: { assignmentId: created.assignment.id, toStatus: "CANCELLED" },
      });
      expect(event.actorEvidence).toEqual({
        subject: CANCELLATION_SYSTEM_ACTOR,
      });
      expect(
        await db.client.assignmentCancellationContext.findUnique({
          where: { eventId: event.id },
        }),
      ).toMatchObject({
        reason: purpose + "_WITHDRAWN",
        sourceTaskId: task.id,
        initiatorEvidence: { kind: "CONSENT_SUBJECT", subject: task.subjectId },
      });
      expect(
        await db.client.assignmentWithdrawalReceipt.findUnique({
          where: { withdrawalTaskId: task.id },
        }),
      ).not.toBeNull();
      expect(
        (
          await db.client.consentWithdrawalTask.findUniqueOrThrow({
            where: { id: task.id },
          })
        ).status,
      ).toBe("PENDING");
      expect(
        await db.client.video.findUnique({ where: { id: seed.video.id } }),
      ).toMatchObject({ status: "READY", deletedAt: null });
    },
  );
  test("old withdrawal never cancels a fresh assignment after re-consent", async () => {
    const seed = await fixture(),
      old = await create(seed),
      task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    await cancellation().processWithdrawal(task.id);
    await patchConsent(seed.owner.id, 2, "EXPERT_VIDEO_REVIEW", true);
    const fresh = await create(seed);
    await cancellation().processWithdrawal(task.id);
    await worker().runOnce();
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: old.assignment.id },
      }),
    ).toMatchObject({ status: "CANCELLED", revision: 1n });
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: fresh.assignment.id },
      }),
    ).toMatchObject({
      status: "ASSIGNED",
      revision: 0n,
      reviewConsentVersion: 3n,
    });
  });
  test("new storage generation survives an older storage withdrawal", async () => {
    const seed = await fixture(),
      old = await create(seed),
      task = await withdrawal(seed, "VIDEO_STORAGE");
    await patchConsent(seed.owner.id, 2, "VIDEO_STORAGE", true);
    const newer = await db.client.video.create({
      data: {
        ownerId: seed.owner.id,
        bucket: "synthetic-private",
        objectKey: randomUUID(),
        mimeType: "video/mp4",
        status: "READY",
        storageConsentVersion: 3n,
      },
    });
    const fresh = await request(seed.moderator.cookie, {
      ...seed.body,
      videoId: newer.id,
    });
    expect(fresh.status).toBe(201);
    const result = (await fresh.json()) as { assignment: { id: string } };
    await cancellation().processWithdrawal(task.id);
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: old.assignment.id },
      }),
    ).toMatchObject({ status: "CANCELLED" });
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: result.assignment.id },
      }),
    ).toMatchObject({ status: "ASSIGNED", revision: 0n });
  });
  test("foreign member cannot trigger deletion cancellation", async () => {
    const seed = await fixture(),
      created = await create(seed),
      other = await user("MEMBER");
    expect((await remove(other.cookie, seed.video.id)).status).toBe(404);
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "ASSIGNED", revision: 0n });
  });
  test("final audit failure rolls back deletion, cleanup, cancellation, context and owner mapping", async () => {
    const seed = await fixture(),
      created = await create(seed);
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION c051_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ASSIGNMENT_PRIVACY_CANCELLED' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`,
    );
    await db.client.$executeRawUnsafe(
      'CREATE TRIGGER c051_test_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c051_test_fail()',
    );
    try {
      expect((await remove(seed.owner.cookie, seed.video.id)).status).toBe(503);
      expect(
        await db.client.video.findUnique({ where: { id: seed.video.id } }),
      ).toMatchObject({ status: "READY", deletedAt: null });
      expect(
        await db.client.videoCleanupTask.findUnique({
          where: { videoId: seed.video.id },
        }),
      ).toBeNull();
      expect(
        await db.client.expertAssignment.findUnique({
          where: { id: created.assignment.id },
        }),
      ).toMatchObject({ status: "ASSIGNED", revision: 0n });
      expect(
        await db.client.assignmentCancellationContext.count({
          where: { event: { assignmentId: created.assignment.id } },
        }),
      ).toBe(0);
      expect(
        await db.client.expertActorIdentity.findUnique({
          where: { userId: seed.owner.id },
        }),
      ).toBeNull();
    } finally {
      await db.client.$executeRawUnsafe(
        'DROP TRIGGER c051_test_fail ON "AuditLog"',
      );
      await db.client.$executeRawUnsafe("DROP FUNCTION c051_test_fail()");
    }
    expect((await remove(seed.owner.cookie, seed.video.id)).status).toBe(202);
  });
  test("worker retries a failed task and evidence survives live-resource deletion", async () => {
    const seed = await fixture(),
      created = await create(seed),
      task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    const fault = jest
      .spyOn(cancellation(), "processWithdrawal")
      .mockRejectedValueOnce(
        new Error("PRIVATE signed-url and database credentials"),
      );
    await worker().runOnce();
    fault.mockRestore();
    expect(
      await db.client.assignmentWithdrawalReceipt.findUnique({
        where: { withdrawalTaskId: task.id },
      }),
    ).toBeNull();
    await worker().runOnce();
    const contexts = await db.client.assignmentCancellationContext.findMany({
      where: { sourceTaskId: task.id },
    });
    expect(contexts).toHaveLength(1);
    await db.client.video.delete({ where: { id: seed.video.id } });
    await db.client.user.delete({ where: { id: seed.owner.id } });
    expect(await cancellation().processWithdrawal(task.id)).toMatchObject({
      completed: true,
      cancelled: 0,
    });
    expect(
      await db.client.assignmentEvent.findMany({
        where: { assignmentId: created.assignment.id, toStatus: "CANCELLED" },
      }),
    ).toHaveLength(1);
    expect(
      await db.client.assignmentCancellationContext.findMany({
        where: { sourceTaskId: task.id },
      }),
    ).toEqual(contexts);
    await expect(
      db.client.assignmentCancellationContext.delete({
        where: { eventId: contexts[0].eventId },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.assignmentWithdrawalReceipt.delete({
        where: { withdrawalTaskId: task.id },
      }),
    ).rejects.toThrow();
  });
  test("two real worker transactions serialize under the owner lock", async () => {
    const seed = await fixture(),
      created = await create(seed),
      task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    let ready!: () => void,
      release!: () => void,
      pid = 0;
    const entered = new Promise<void>((r) => {
        ready = r;
      }),
      barrier = new Promise<void>((r) => {
        release = r;
      });
    const original = db.client.$transaction.bind(db.client) as unknown as (
      work: (
        tx: import("@prisma/client").Prisma.TransactionClient,
      ) => Promise<unknown>,
      options?: object,
    ) => Promise<unknown>;
    const spy = jest
      .spyOn(db.client, "$transaction")
      .mockImplementationOnce((async (work: unknown, options?: object) => {
        if (typeof work !== "function")
          throw Error("Expected transaction callback");
        return original(async (tx) => {
          const result = await work(tx);
          const [b] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          pid = b.pid;
          ready();
          await barrier;
          return result;
        }, options);
      }) as unknown as typeof db.client.$transaction);
    const first = cancellation().processWithdrawal(task.id);
    let second:
      | ReturnType<AssignmentCancellationService["processWithdrawal"]>
      | undefined;
    try {
      await entered;
      second = cancellation().processWithdrawal(task.id);
      let blocked = false;
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const rows = await db.client.$queryRaw<
          { pid: number }[]
        >`SELECT pid FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))`;
        if (rows.length) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
      release();
      expect(
        (await Promise.all([first, second])).map((r) => r.cancelled).sort(),
      ).toEqual([0, 1]);
      expect(
        await db.client.assignmentEvent.count({
          where: { assignmentId: created.assignment.id, toStatus: "CANCELLED" },
        }),
      ).toBe(1);
    } finally {
      release();
      spy.mockRestore();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });
  test("consumer handles more than one batch without premature receipt", async () => {
    const seed = await fixture();
    await create(seed);
    const credential = await db.client.expertCredential.findUniqueOrThrow({
      where: { userId: seed.expert.id },
    });
    const ledger = await db.client.consentLedger.findUniqueOrThrow({
      where: { userId: seed.owner.id },
    });
    for (let i = 0; i < 24; i++) {
      const video = await db.client.video.create({
        data: {
          ownerId: seed.owner.id,
          bucket: "synthetic-private",
          objectKey: randomUUID(),
          mimeType: "video/mp4",
          status: "READY",
          storageConsentVersion: 1n,
        },
      });
      await db.client.$transaction(async (tx) => {
        const row = await tx.expertAssignment.create({
          data: {
            videoId: video.id,
            expertId: seed.expert.id,
            assignedByEvidence: { subject: "synthetic-moderator" },
            credentialApprovalId: credential.approvalId,
            reviewConsentSubjectId: ledger.subjectId,
            reviewConsentVersion: 1n,
          },
        });
        await assignmentEvent(tx, row.id, null);
      });
    }
    const task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    expect(await cancellation().processWithdrawal(task.id)).toMatchObject({
      cancelled: 20,
      completed: false,
    });
    expect(
      await db.client.assignmentWithdrawalReceipt.findUnique({
        where: { withdrawalTaskId: task.id },
      }),
    ).toBeNull();
    expect(await cancellation().processWithdrawal(task.id)).toMatchObject({
      cancelled: 5,
      completed: true,
    });
    expect(
      await db.client.assignmentCancellationContext.count({
        where: { sourceTaskId: task.id },
      }),
    ).toBe(25);
  });
  test("late task scan does not cancel a fresh review generation even without an earlier receipt", async () => {
    const seed = await fixture();
    await create(seed);
    const task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    expect((await remove(seed.owner.cookie, seed.video.id)).status).toBe(202);
    await patchConsent(seed.owner.id, 2, "EXPERT_VIDEO_REVIEW", true);
    const video = await db.client.video.create({
      data: {
        ownerId: seed.owner.id,
        bucket: "synthetic-private",
        objectKey: randomUUID(),
        mimeType: "video/mp4",
        status: "READY",
        storageConsentVersion: 1n,
      },
    });
    const response = await request(seed.moderator.cookie, {
      ...seed.body,
      videoId: video.id,
    });
    expect(response.status).toBe(201);
    const fresh = (await response.json()) as { assignment: { id: string } };
    expect(await cancellation().processWithdrawal(task.id)).toMatchObject({
      cancelled: 0,
      completed: true,
    });
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: fresh.assignment.id },
      }),
    ).toMatchObject({
      status: "ASSIGNED",
      revision: 0n,
      reviewConsentVersion: 3n,
    });
  });
  test("missing subject mapping remains pending without starving another valid task", async () => {
    const broken = await fixture();
    await create(broken);
    const bad = await withdrawal(broken, "EXPERT_VIDEO_REVIEW");
    await db.client.consentLedger.delete({
      where: { userId: broken.owner.id },
    });
    const seed = await fixture(),
      created = await create(seed),
      task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    await worker().runOnce();
    expect(
      await db.client.assignmentWithdrawalReceipt.findUnique({
        where: { withdrawalTaskId: bad.id },
      }),
    ).toBeNull();
    expect(
      await db.client.assignmentWithdrawalReceipt.findUnique({
        where: { withdrawalTaskId: task.id },
      }),
    ).not.toBeNull();
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "CANCELLED" });
  });
  test("discovered deleted video uses a system actor and unknown initiator without inventing owner action", async () => {
    const seed = await fixture(),
      created = await create(seed);
    await db.client.video.update({
      where: { id: seed.video.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    expect(await cancellation().processDeletedVideo(seed.video.id)).toBe(1);
    expect(await cancellation().processDeletedVideo(seed.video.id)).toBe(0);
    const event = await db.client.assignmentEvent.findFirstOrThrow({
      where: { assignmentId: created.assignment.id, toStatus: "CANCELLED" },
    });
    expect(event.actorEvidence).toEqual({ subject: CANCELLATION_SYSTEM_ACTOR });
    expect(
      await db.client.assignmentCancellationContext.findUnique({
        where: { eventId: event.id },
      }),
    ).toMatchObject({
      reason: "VIDEO_DELETED",
      sourceTaskId: null,
      initiatorEvidence: { kind: "UNKNOWN" },
    });
    expect(
      await db.client.expertActorIdentity.findUnique({
        where: { userId: seed.owner.id },
      }),
    ).toBeNull();
  });

  test("CAS failure never creates cancellation history or a receipt", async () => {
    const seed = await fixture(),
      created = await create(seed),
      task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION c051_skip_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='CANCELLED' THEN RETURN NULL; END IF; RETURN NEW; END $$`,
    );
    await db.client.$executeRawUnsafe(
      'CREATE TRIGGER c051_skip_update BEFORE UPDATE ON "ExpertAssignment" FOR EACH ROW EXECUTE FUNCTION c051_skip_update()',
    );
    try {
      await expect(
        cancellation().processWithdrawal(task.id),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await db.client.$executeRawUnsafe(
        'DROP TRIGGER c051_skip_update ON "ExpertAssignment"',
      );
      await db.client.$executeRawUnsafe("DROP FUNCTION c051_skip_update()");
    }
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "ASSIGNED", revision: 0n });
    expect(
      await db.client.assignmentCancellationContext.count({
        where: { sourceTaskId: task.id },
      }),
    ).toBe(0);
    expect(
      await db.client.assignmentWithdrawalReceipt.findUnique({
        where: { withdrawalTaskId: task.id },
      }),
    ).toBeNull();
    expect((await cancellation().processWithdrawal(task.id)).cancelled).toBe(1);
  });
  test("legacy NULL review binding is cancelled without inventing or rebinding consent", async () => {
    const seed = await fixture(),
      credential = await db.client.expertCredential.findUniqueOrThrow({
        where: { userId: seed.expert.id },
      });
    const assignment = await db.client.$transaction(async (tx) => {
      const row = await tx.expertAssignment.create({
        data: {
          videoId: seed.video.id,
          expertId: seed.expert.id,
          assignedByEvidence: { subject: "synthetic-legacy" },
          credentialApprovalId: credential.approvalId,
        },
      });
      await assignmentEvent(tx, row.id, null);
      return row;
    });
    const task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    await cancellation().processWithdrawal(task.id);
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: assignment.id },
      }),
    ).toMatchObject({
      status: "CANCELLED",
      revision: 1n,
      reviewConsentSubjectId: null,
      reviewConsentVersion: null,
    });
  });
  test("worker cancellation remains possible when accounts are suspended", async () => {
    const seed = await fixture(),
      created = await create(seed),
      task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    await db.client.user.updateMany({
      where: { id: { in: [seed.owner.id, seed.expert.id] } },
      data: { status: "SUSPENDED" },
    });
    expect((await cancellation().processWithdrawal(task.id)).cancelled).toBe(1);
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "CANCELLED" });
  });
  test("no unrelated consent purpose can drive assignment cancellation", async () => {
    const seed = await fixture(),
      created = await create(seed);
    await app.get(ConsentService).patch(
      seed.owner.id,
      {
        expectedVersion: 1,
        consents: [{ purpose: "PROFILE_MATCHING", granted: false }],
      },
      randomUUID(),
    );
    const ledger = await db.client.consentLedger.findUniqueOrThrow({
      where: { userId: seed.owner.id },
    });
    const task = await db.client.consentWithdrawalTask.findFirstOrThrow({
      where: { subjectId: ledger.subjectId, purpose: "PROFILE_MATCHING" },
    });
    await expect(
      cancellation().processWithdrawal(task.id),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      await db.client.assignmentWithdrawalReceipt.findUnique({
        where: { withdrawalTaskId: task.id },
      }),
    ).toBeNull();
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "ASSIGNED", revision: 0n });
  });
  test("cancellation does not authorize retroactive context or erasure of immutable evidence", async () => {
    const seed = await fixture(),
      created = await create(seed);
    await transition(db.client, created.assignment.id, 0n, "CANCELLED");
    const event = await db.client.assignmentEvent.findFirstOrThrow({
      where: { assignmentId: created.assignment.id, toStatus: "CANCELLED" },
    });
    await expect(
      db.client.assignmentCancellationContext.create({
        data: {
          eventId: event.id,
          reason: "VIDEO_DELETED",
          initiatorEvidence: { kind: "UNKNOWN" },
        },
      }),
    ).rejects.toThrow();
    const next = await fixture();
    await create(next);
    const task = await withdrawal(next, "EXPERT_VIDEO_REVIEW");
    await cancellation().processWithdrawal(task.id);
    const context =
      await db.client.assignmentCancellationContext.findFirstOrThrow({
        where: { sourceTaskId: task.id },
      });
    await expect(
      db.client.assignmentCancellationContext.update({
        where: { eventId: context.eventId },
        data: { initiatorEvidence: { kind: "UNKNOWN" } },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.$executeRawUnsafe('TRUNCATE "AssignmentCancellationContext"'),
    ).rejects.toThrow();
    await expect(
      db.client.$executeRawUnsafe('TRUNCATE "AssignmentWithdrawalReceipt"'),
    ).rejects.toThrow();
  });

  test("cancellation and context timestamps remain UTC in a non-UTC transaction", async () => {
    const seed = await fixture(),
      created = await create(seed);
    await db.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Bangkok'");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${seed.owner.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${seed.video.id} FOR UPDATE`;
      await tx.video.update({
        where: { id: seed.video.id },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      const [start] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
      await cancellation().cancelDeletedVideoInTransaction(
        tx,
        seed.owner.id,
        seed.video.id,
        false,
      );
      const row = await tx.expertAssignment.findUniqueOrThrow({
        where: { id: created.assignment.id },
      });
      const context = await tx.assignmentCancellationContext.findFirstOrThrow({
        where: { event: { assignmentId: created.assignment.id } },
      });
      const [end] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
      expect(row.cancelledAt!.getTime()).toBeGreaterThanOrEqual(
        start.now.getTime(),
      );
      expect(row.cancelledAt!.getTime()).toBeLessThanOrEqual(end.now.getTime());
      expect(context.createdAt.getTime()).toBeGreaterThanOrEqual(
        start.now.getTime(),
      );
      expect(context.createdAt.getTime()).toBeLessThanOrEqual(
        end.now.getTime(),
      );
    });
  });
  test("actual C034 playback is allowed before owner deletion and denied after atomic cancellation", async () => {
    const seed = await fixture(),
      created = await create(seed);
    const play = () =>
      fetch(
        base + "/api/expert/assignments/" + created.assignment.id + "/playback",
        {
          method: "POST",
          headers: {
            Cookie: seed.expert.cookie,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
    expect((await play()).status).toBe(200);
    expect((await remove(seed.owner.cookie, seed.video.id)).status).toBe(202);
    expect((await play()).status).toBe(403);
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "CANCELLED", revision: 1n });
  });
  test("worker database failure rolls back its receipt and is safely retried", async () => {
    const seed = await fixture(),
      created = await create(seed),
      task = await withdrawal(seed, "EXPERT_VIDEO_REVIEW");
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION c051_worker_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ASSIGNMENT_PRIVACY_CANCELLED' THEN RAISE EXCEPTION 'synthetic database failure'; END IF; RETURN NEW; END $$`,
    );
    await db.client.$executeRawUnsafe(
      'CREATE TRIGGER c051_worker_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c051_worker_fail()',
    );
    try {
      await worker().runOnce();
      expect(
        await db.client.assignmentWithdrawalReceipt.findUnique({
          where: { withdrawalTaskId: task.id },
        }),
      ).toBeNull();
      expect(
        await db.client.expertAssignment.findUnique({
          where: { id: created.assignment.id },
        }),
      ).toMatchObject({ status: "ASSIGNED", revision: 0n });
      expect(
        await db.client.assignmentCancellationContext.count({
          where: { sourceTaskId: task.id },
        }),
      ).toBe(0);
    } finally {
      await db.client.$executeRawUnsafe(
        'DROP TRIGGER c051_worker_fail ON "AuditLog"',
      );
      await db.client.$executeRawUnsafe("DROP FUNCTION c051_worker_fail()");
    }
    await worker().runOnce();
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "CANCELLED", revision: 1n });
    expect(
      await db.client.assignmentCancellationContext.count({
        where: { sourceTaskId: task.id },
      }),
    ).toBe(1);
  });
  test("legacy DELETED metadata without a deletion timestamp is cancelled without inventing its deletion time", async () => {
    const seed = await fixture(),
      created = await create(seed);
    await db.client.video.update({
      where: { id: seed.video.id },
      data: { status: "DELETED", deletedAt: null },
    });
    expect(await cancellation().processDeletedVideo(seed.video.id)).toBe(1);
    expect(
      await db.client.video.findUnique({ where: { id: seed.video.id } }),
    ).toMatchObject({ status: "DELETED", deletedAt: null });
    expect(
      await db.client.expertAssignment.findUnique({
        where: { id: created.assignment.id },
      }),
    ).toMatchObject({ status: "CANCELLED", revision: 1n });
  });
});
