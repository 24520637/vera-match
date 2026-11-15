import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { PrismaService } from "../src/database/prisma.service";
import { EmailService } from "../src/auth/email.service";
import { createServer } from "node:net";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { configureApplication } from "../src/configure-app";
import { PasswordService } from "../src/auth/password.service";
import {
  PasswordRecoveryService,
  hashResetToken,
} from "../src/auth/password-recovery.service";
import { createAuthDatabase } from "./disposable-auth-database";
import {
  clearTestEmails,
  findTestEmails,
  readResetEmail,
} from "./mailpit-fixtures";

describe("password recovery / real PostgreSQL / native Mailpit", () => {
  let database: Awaited<ReturnType<typeof createAuthDatabase>>;
  let app: INestApplication;
  let base: string;
  let origin: string;
  const recipients: string[] = [];
  beforeAll(async () => {
    database = await createAuthDatabase();
  }, 60000);
  beforeEach(async () => {
    const values = parseEnvironment({
      ...process.env,
      DATABASE_URL: database.url,
    });
    origin = values.corsOrigin;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService)
      .useValue({ values })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(async () => {
    try {
      for (const email of recipients) await clearTestEmails(email);
    } finally {
      await database?.close();
    }
  });
  const newEmail = () => {
    const email = `recovery-${randomUUID()}@example.invalid`;
    recipients.push(email);
    return email;
  };
  const post = (
    path: string,
    body: object,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${base}/api/auth/${path}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  const account = async (
    status: "ACTIVE" | "PENDING_EMAIL" | "SUSPENDED" = "ACTIVE",
  ) =>
    database.client.user.create({
      data: {
        email: newEmail(),
        passwordHash: await app
          .get(PasswordService)
          .hash("synthetic-old-password"),
        status,
        emailVerifiedAt: status === "PENDING_EMAIL" ? null : new Date(),
        declaredAdult: true,
      },
    });

  it("returns a generic response, sends an actual fragment link, persists only its hash and throttles issuance", async () => {
    const user = await account();
    const response = await post("forgot-password", {
      email: user.email.toUpperCase(),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const generic = await response.json();
    const mail = await readResetEmail(user.email);
    expect(new URL(mail.link).search).toBe("");
    expect(mail.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await database.client.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(mail.token) },
    });
    expect(row.tokenHash).not.toBe(mail.token);
    expect(row.userId).toBe(user.id);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(1800000);
    for (const email of [
      newEmail(),
      (await account("PENDING_EMAIL")).email,
      (await account("SUSPENDED")).email,
      user.email,
    ]) {
      const result = await post("forgot-password", { email });
      expect(result.status).toBe(202);
      expect(await result.json()).toEqual(generic);
    }
    await app.get(PasswordRecoveryService).onModuleDestroy();
    expect(await database.client.passwordResetToken.count()).toBe(1);
    expect((await findTestEmails(user.email)).length).toBe(1);
  });
  it("atomically consumes a link once, replaces the password and revokes every target session", async () => {
    const user = await account();
    const other = await account();
    const login = async (email: string) => {
      const result = await post("login", {
        email,
        password: "synthetic-old-password",
      });
      expect(result.status).toBe(200);
      return result.headers.get("set-cookie")!.split(";")[0];
    };
    const cookies = await Promise.all([login(user.email), login(user.email)]);
    const otherCookie = await login(other.email);
    await post("forgot-password", { email: user.email });
    const mail = await readResetEmail(user.email);
    const results = await Promise.all([
      post("reset-password", {
        token: mail.token,
        newPassword: "synthetic-new-password-a",
      }),
      post("reset-password", {
        token: mail.token,
        newPassword: "synthetic-new-password-b",
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(results[0].headers.get("set-cookie")).toBeNull();
    const winner =
      results[0].status === 200
        ? "synthetic-new-password-a"
        : "synthetic-new-password-b";
    expect(
      (
        await post("reset-password", {
          token: mail.token,
          newPassword: "another-new-password",
        })
      ).status,
    ).toBe(400);
    for (const Cookie of cookies)
      expect(
        (await fetch(base + "/api/auth/me", { headers: { Cookie } })).status,
      ).toBe(401);
    expect(
      (await fetch(base + "/api/auth/me", { headers: { Cookie: otherCookie } }))
        .status,
    ).toBe(200);
    expect(
      (
        await post("login", {
          email: user.email,
          password: "synthetic-old-password",
        })
      ).status,
    ).toBe(401);
    expect(
      (await post("login", { email: user.email, password: winner })).status,
    ).toBe(200);
    const updated = await database.client.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(updated.passwordHash).toMatch(/^\$argon2id\$/);
    expect(updated.passwordHash).not.toBe(user.passwordHash);
    expect(
      await database.client.auditLog.count({
        where: { actorId: user.id, action: "PASSWORD_RESET_COMPLETED" },
      }),
    ).toBe(1);
  });
  it("rejects malformed, expired and ineligible links without changing a password or activating an account", async () => {
    expect(
      (
        await post("reset-password", {
          token: "bad",
          newPassword: "synthetic-new-password",
        })
      ).status,
    ).toBe(400);
    const user = await account();
    await post("forgot-password", { email: user.email });
    const mail = await readResetEmail(user.email);
    const where = { tokenHash: hashResetToken(mail.token) };
    await database.client.passwordResetToken.update({
      where,
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await post("reset-password", {
      token: mail.token,
      newPassword: "synthetic-new-password",
    });
    expect(expired.status).toBe(400);
    await database.client.passwordResetToken.update({
      where,
      data: { expiresAt: new Date(Date.now() + 60000) },
    });
    for (const status of ["PENDING_EMAIL", "SUSPENDED", "DELETED"] as const) {
      await database.client.user.update({
        where: { id: user.id },
        data: { status },
      });
      const denied = await post("reset-password", {
        token: mail.token,
        newPassword: "synthetic-new-password",
      });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual(await expired.clone().json());
    }
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id: user.id } }))
        .passwordHash,
    ).toBe(user.passwordHash);
    expect(
      (await database.client.passwordResetToken.findUniqueOrThrow({ where }))
        .consumedAt,
    ).toBeNull();
  });
  it("rejects foreign/missing origins, cross-site metadata and non-JSON before recovery, while same-origin JSON works", async () => {
    for (const [path, body] of [
      ["forgot-password", { email: newEmail() }],
      [
        "reset-password",
        { token: "a".repeat(43), newPassword: "synthetic-password" },
      ],
    ] as const) {
      for (const Origin of ["", "null", "https://attacker.invalid"])
        expect((await post(path, body, { Origin })).status).toBe(403);
      expect(
        (await post(path, body, { "Sec-Fetch-Site": "cross-site" })).status,
      ).toBe(403);
      expect(
        (await post(path, body, { "Content-Type": "text/plain" })).status,
      ).toBe(415);
      expect(
        (await post(path, body, { "Sec-Fetch-Site": "same-origin" })).status,
      ).toBe(path === "forgot-password" ? 202 : 400);
    }
    expect(
      (await post("forgot-password", { email: newEmail(), role: "ADMIN" }))
        .status,
    ).toBe(400);
  });
  it("returns consistent 429 feedback and ignores forged forwarded IPs under direct access", async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (
          await post(
            "forgot-password",
            { email: newEmail() },
            { "X-Forwarded-For": "192.0.2." + (i + 1) },
          )
        ).status,
      ).toBe(202);
    const limited = await post(
      "forgot-password",
      { email: newEmail() },
      { "X-Forwarded-For": "203.0.113.200" },
    );
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as {
      code: string;
      retryAfterSeconds: number;
    };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.headers.get("retry-after")).toBe(
      String(body.retryAfterSeconds),
    );
    expect(limited.headers.get("set-cookie")).toBeNull();
    for (let i = 0; i < 5; i++)
      expect(
        (
          await post("reset-password", {
            token: "a".repeat(43),
            newPassword: "synthetic-password",
          })
        ).status,
      ).toBe(400);
    const reset = await post("reset-password", {
      token: "a".repeat(43),
      newPassword: "synthetic-password",
    });
    expect(reset.status).toBe(429);
    expect(reset.headers.get("retry-after")).toBe(
      String(
        ((await reset.json()) as { retryAfterSeconds: number })
          .retryAfterSeconds,
      ),
    );
  });
  it("rolls back token consumption, password and sessions when the audit insert fails", async () => {
    const user = await account();
    const loggedIn = await post("login", {
      email: user.email,
      password: "synthetic-old-password",
    });
    const Cookie = loggedIn.headers.get("set-cookie")!.split(";")[0];
    await post("forgot-password", { email: user.email });
    const mail = await readResetEmail(user.email);
    // This entire database is a guarded disposable synthetic schema, never public or application data.
    await database.client.$executeRawUnsafe(
      `CREATE FUNCTION fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PASSWORD_RESET_COMPLETED' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await database.client.$executeRawUnsafe(
      `CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_recovery_audit()`,
    );
    try {
      const response = await post("reset-password", {
        token: mail.token,
        newPassword: "synthetic-replacement-password",
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        code: "RESET_UNAVAILABLE",
        message: "Password reset is temporarily unavailable. Try again later.",
      });
      expect(
        (
          await database.client.user.findUniqueOrThrow({
            where: { id: user.id },
          })
        ).passwordHash,
      ).toBe(user.passwordHash);
      expect(
        (
          await database.client.passwordResetToken.findUniqueOrThrow({
            where: { tokenHash: hashResetToken(mail.token) },
          })
        ).consumedAt,
      ).toBeNull();
      expect(
        (await fetch(base + "/api/auth/me", { headers: { Cookie } })).status,
      ).toBe(200);
      expect(
        await database.client.auditLog.count({ where: { actorId: user.id } }),
      ).toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        `DROP TRIGGER fail_recovery_audit ON "AuditLog"`,
      );
      await database.client.$executeRawUnsafe(
        `DROP FUNCTION fail_recovery_audit()`,
      );
    }
    expect(
      (
        await post("reset-password", {
          token: mail.token,
          newPassword: "synthetic-replacement-password",
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(base + "/api/auth/me", { headers: { Cookie } })).status,
    ).toBe(401);
  });
  it("invalidates an undelivered token without leaking the SMTP failure through the request response", async () => {
    const user = await account();
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    const original = app.get(EnvironmentService).values;
    const environment = {
      values: {
        ...original,
        smtp: { ...original.smtp, host: "127.0.0.1", port },
      },
    } as EnvironmentService;
    const mailer = new EmailService(environment);
    const recovery = new PasswordRecoveryService(
      app.get(PrismaService),
      environment,
      mailer,
    );
    try {
      const accepted = recovery.request(user.email);
      expect(accepted.message).toContain("If this address is eligible");
      await recovery.onModuleDestroy();
      expect(
        (
          await database.client.passwordResetToken.findFirstOrThrow({
            where: { userId: user.id },
          })
        ).consumedAt,
      ).not.toBeNull();
      expect(await findTestEmails(user.email)).toEqual([]);
    } finally {
      await recovery.onModuleDestroy();
      mailer.onApplicationShutdown();
    }
  });
  it("supersedes old links after the persisted cooldown and limits issuance across worker restarts", async () => {
    const user = await account();
    const issue = async () => {
      const worker = new PasswordRecoveryService(
        app.get(PrismaService),
        app.get(EnvironmentService),
        app.get(EmailService),
      );
      worker.request(user.email);
      await worker.onModuleDestroy();
    };
    await issue();
    const first = await readResetEmail(user.email);
    await issue();
    expect(
      await database.client.passwordResetToken.count({
        where: { userId: user.id },
      }),
    ).toBe(1);
    await database.client.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    await issue();
    const second = await readResetEmail(user.email, [first.id]);
    expect(
      (
        await post("reset-password", {
          token: first.token,
          newPassword: "synthetic-new-password",
        })
      ).status,
    ).toBe(400);
    await database.client.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    await issue();
    await database.client.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    await issue();
    expect(
      await database.client.passwordResetToken.count({
        where: { userId: user.id },
      }),
    ).toBe(3);
    expect(
      (
        await database.client.passwordResetToken.findUniqueOrThrow({
          where: { tokenHash: hashResetToken(second.token) },
        })
      ).consumedAt,
    ).not.toBeNull();
    expect((await findTestEmails(user.email)).length).toBe(3);
  });
  it("separates real direct clients but exposes the documented shared-proxy quota without trusting forwarding headers", async () => {
    const send = (
      localAddress: string,
      email: string,
      target = base,
      forwarded = "192.0.2.1",
    ) =>
      new Promise<{
        status: number;
        body: { code?: string; retryAfterSeconds?: number };
        retry?: string;
      }>((resolve, reject) => {
        const req = httpRequest(
          target + "/api/auth/forgot-password",
          {
            method: "POST",
            localAddress,
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              "X-Forwarded-For": forwarded,
              "X-Real-IP": forwarded,
            },
          },
          (response) => {
            let text = "";
            response.on("data", (chunk) => (text += chunk));
            response.on("end", () => {
              try {
                resolve({
                  status: response.statusCode!,
                  body: JSON.parse(text),
                  retry: response.headers["retry-after"],
                });
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify({ email }));
      });
    const target = newEmail();
    for (let i = 0; i < 3; i++)
      expect((await send("127.0.0.2", target)).status).toBe(202);
    expect((await send("127.0.0.2", target, base, "203.0.113.9")).status).toBe(
      429,
    );
    expect((await send("127.0.0.3", target)).status).toBe(202);
    const proxy = createHttpServer((incoming, outgoing) => {
      const upstream = httpRequest(
        new URL(incoming.url ?? "/", base),
        { method: incoming.method, headers: incoming.headers },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      expect(app.getHttpAdapter().getInstance().get("trust proxy")).toBe(false);
      const proxyUrl =
        "http://127.0.0.1:" + (proxy.address() as { port: number }).port;
      const email = newEmail();
      for (let i = 0; i < 3; i++)
        expect(
          (await send("127.0.0.2", email, proxyUrl, "192.0.2." + i)).status,
        ).toBe(202);
      // A second real browser-facing client still shares the API-facing proxy socket.
      const shared = await send("127.0.0.3", email, proxyUrl, "203.0.113.8");
      expect(shared.status).toBe(429);
      expect(shared.retry).toBe(String(shared.body.retryAfterSeconds));
      for (let i = 0; i < 6; i++)
        expect((await send("127.0.0.3", newEmail(), proxyUrl)).status).toBe(
          202,
        );
      const socketLimit = await send("127.0.0.2", newEmail(), proxyUrl);
      expect(socketLimit.status).toBe(429);
      expect(socketLimit.retry).toBe(
        String(socketLimit.body.retryAfterSeconds),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("preserves the last delivered link through a native SMTP greeting timeout and waits for shutdown", async () => {
    const user = await account();
    const firstWorker = new PasswordRecoveryService(
      app.get(PrismaService),
      app.get(EnvironmentService),
      app.get(EmailService),
    );
    firstWorker.request(user.email);
    await firstWorker.onModuleDestroy();
    const first = await readResetEmail(user.email);
    await database.client.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    const sockets = new Set<import("node:net").Socket>();
    let connected!: () => void;
    const connection = new Promise<void>((resolve) => {
      connected = resolve;
    });
    const stalledSmtp = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      connected(); /* Intentionally no greeting: exercise the real transport timeout. */
    });
    await new Promise<void>((resolve) =>
      stalledSmtp.listen(0, "127.0.0.1", resolve),
    );
    const original = app.get(EnvironmentService).values;
    const environment = {
      values: {
        ...original,
        smtp: {
          ...original.smtp,
          host: "127.0.0.1",
          port: (stalledSmtp.address() as { port: number }).port,
          secure: false,
          requireTls: false,
        },
      },
    } as EnvironmentService;
    const mailer = new EmailService(environment);
    const worker = new PasswordRecoveryService(
      app.get(PrismaService),
      environment,
      mailer,
    );
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const accepted = worker.request(user.email);
    const shutdown = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    try {
      await Promise.race([
        connection,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Synthetic SMTP connection did not start")),
            3000,
          );
        }),
      ]);
      clearTimeout(timer);
      expect(stopped).toBe(false);
      expect(accepted.message).toContain("Request received");
      expect(accepted.message).not.toMatch(/sent|delivered/i);
      await shutdown;
      const rows = await database.client.passwordResetToken.findMany({
        where: { userId: user.id },
      });
      expect(rows).toHaveLength(2);
      expect(
        rows.find((row) => row.tokenHash === hashResetToken(first.token))!
          .consumedAt,
      ).toBeNull();
      expect(
        rows.find((row) => row.tokenHash !== hashResetToken(first.token))!
          .consumedAt,
      ).not.toBeNull();
      expect((await findTestEmails(user.email)).length).toBe(1);
      expect(
        (
          await post("reset-password", {
            token: first.token,
            newPassword: "synthetic-timeout-recovery-password",
          })
        ).status,
      ).toBe(200);
    } finally {
      clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await shutdown;
      mailer.onApplicationShutdown();
      await new Promise<void>((resolve, reject) =>
        stalledSmtp.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("does not let an older delayed SMTP acknowledgement invalidate a newer delivered link", async () => {
    const user = await account();
    const realMailer = app.get(EmailService);
    let release!: () => void;
    let sent!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const delayedMailer = {
      sendPasswordReset: async (email: string, link: string) => {
        await realMailer.sendPasswordReset(email, link);
        sent();
        await gate;
      },
    } as EmailService;
    const older = new PasswordRecoveryService(
      app.get(PrismaService),
      app.get(EnvironmentService),
      delayedMailer,
    );
    older.request(user.email);
    const olderDone = older.onModuleDestroy();
    try {
      await received;
      const first = await readResetEmail(user.email);
      await database.client.passwordResetToken.updateMany({
        where: { userId: user.id },
        data: { createdAt: new Date(Date.now() - 61000) },
      });
      const newer = new PasswordRecoveryService(
        app.get(PrismaService),
        app.get(EnvironmentService),
        realMailer,
      );
      newer.request(user.email);
      await newer.onModuleDestroy();
      const second = await readResetEmail(user.email, [first.id]);
      release();
      await olderDone;
      expect(
        (
          await post("reset-password", {
            token: first.token,
            newPassword: "synthetic-delayed-old-password",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post("reset-password", {
            token: second.token,
            newPassword: "synthetic-confirmed-new-password",
          })
        ).status,
      ).toBe(200);
    } finally {
      release();
      await olderDone;
    }
  });

  it("serializes resets from old and newly emailed links while SMTP confirmation is pending, without reactivation", async () => {
    const user = await account();
    const firstWorker = new PasswordRecoveryService(
      app.get(PrismaService),
      app.get(EnvironmentService),
      app.get(EmailService),
    );
    firstWorker.request(user.email);
    await firstWorker.onModuleDestroy();
    const first = await readResetEmail(user.email);
    await database.client.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    let release!: () => void;
    let sent!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const delayedMailer = {
      sendPasswordReset: async (email: string, link: string) => {
        await app.get(EmailService).sendPasswordReset(email, link);
        sent();
        await gate;
      },
    } as EmailService;
    const worker = new PasswordRecoveryService(
      app.get(PrismaService),
      app.get(EnvironmentService),
      delayedMailer,
    );
    worker.request(user.email);
    const done = worker.onModuleDestroy();
    try {
      await received;
      const second = await readResetEmail(user.email, [first.id]);
      expect(
        await database.client.passwordResetToken.count({
          where: { userId: user.id, consumedAt: null },
        }),
      ).toBe(2);
      const result = await Promise.all([
        post("reset-password", {
          token: first.token,
          newPassword: "synthetic-old-link-winner",
        }),
        post("reset-password", {
          token: second.token,
          newPassword: "synthetic-new-link-winner",
        }),
      ]);
      expect(result.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      release();
      await done;
      expect(
        await database.client.passwordResetToken.count({
          where: { userId: user.id, consumedAt: null },
        }),
      ).toBe(0);
      expect(
        await database.client.auditLog.count({
          where: { actorId: user.id, action: "PASSWORD_RESET_COMPLETED" },
        }),
      ).toBe(1);
      const password =
        result[0].status === 200
          ? "synthetic-old-link-winner"
          : "synthetic-new-link-winner";
      expect(
        (await post("login", { email: user.email, password })).status,
      ).toBe(200);
      expect(
        (
          await post("reset-password", {
            token: second.token,
            newPassword: "synthetic-replay-password",
          })
        ).status,
      ).toBe(400);
    } finally {
      release();
      await done;
    }
  });
  it.each(["rollback", "lost-commit-ack"] as const)(
    "keeps an emailed token usable after post-SMTP finalization %s",
    async (failure) => {
      const user = await account();
      const login = await post("login", {
        email: user.email,
        password: "synthetic-old-password",
      });
      expect(login.status).toBe(200);
      const Cookie = login.headers.get("set-cookie")!.split(";")[0];
      const prisma = app.get(PrismaService);
      const firstWorker = new PasswordRecoveryService(
        prisma,
        app.get(EnvironmentService),
        app.get(EmailService),
      );
      firstWorker.request(user.email);
      await firstWorker.onModuleDestroy();
      const first = await readResetEmail(user.email);
      const oldHash = hashResetToken(first.token);
      await database.client.passwordResetToken.update({
        where: { tokenHash: oldHash },
        data: { createdAt: new Date(Date.now() - 61000) },
      });
      // A real PostgreSQL error rolls back supersession; alternatively lose confirmation
      // only after the real finalization transaction commits, to model an ambiguous outcome.
      let transactionSpy: jest.SpyInstance | undefined;
      let committedTransactions = 0;
      if (failure === "rollback") {
        await database.client.$executeRawUnsafe(
          `CREATE FUNCTION fail_reset_finalization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."tokenHash" = TG_ARGV[0] AND OLD."consumedAt" IS NULL AND NEW."consumedAt" IS NOT NULL THEN RAISE EXCEPTION 'Synthetic post-SMTP finalization failure'; END IF; RETURN NEW; END $$`,
        );
        await database.client.$executeRawUnsafe(
          `CREATE TRIGGER fail_reset_finalization BEFORE UPDATE ON "PasswordResetToken" FOR EACH ROW EXECUTE FUNCTION fail_reset_finalization('${oldHash}')`,
        );
      } else {
        const realTransaction = prisma.$transaction.bind(prisma);
        transactionSpy = jest
          .spyOn(prisma, "$transaction")
          .mockImplementation(async (...args) => {
            const result = await Reflect.apply(realTransaction, prisma, args);
            if (++committedTransactions === 2)
              throw new Error(
                "Synthetic lost finalization commit acknowledgement",
              );
            return result;
          });
      }
      let second!: Awaited<ReturnType<typeof readResetEmail>>;
      try {
        const unknown = await post("forgot-password", { email: newEmail() });
        const response = await post("forgot-password", { email: user.email });
        expect(response.status).toBe(202);
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(await response.json()).toEqual(await unknown.json());
        await app.get(PasswordRecoveryService).onModuleDestroy();
        second = await readResetEmail(user.email, [first.id]);
        const current =
          await database.client.passwordResetToken.findUniqueOrThrow({
            where: { tokenHash: hashResetToken(second.token) },
          });
        expect(current.consumedAt).toBeNull();
        expect(current.expiresAt.getTime()).toBeGreaterThan(Date.now());
        const previous =
          await database.client.passwordResetToken.findUniqueOrThrow({
            where: { tokenHash: oldHash },
          });
        if (failure === "rollback") expect(previous.consumedAt).toBeNull();
        else {
          expect(previous.consumedAt).not.toBeNull();
          expect(committedTransactions).toBe(2);
        }
        expect(
          (
            await database.client.user.findUniqueOrThrow({
              where: { id: user.id },
            })
          ).passwordHash,
        ).toBe(user.passwordHash);
        expect(
          (await fetch(base + "/api/auth/me", { headers: { Cookie } })).status,
        ).toBe(200);
      } finally {
        transactionSpy?.mockRestore();
        if (failure === "rollback") {
          await database.client.$executeRawUnsafe(
            `DROP TRIGGER fail_reset_finalization ON "PasswordResetToken"`,
          );
          await database.client.$executeRawUnsafe(
            `DROP FUNCTION fail_reset_finalization()`,
          );
        }
      }
      const newPassword = "synthetic-finalization-recovery-password";
      const resets = await Promise.all([
        post("reset-password", { token: second.token, newPassword }),
        post("reset-password", { token: second.token, newPassword }),
      ]);
      expect(resets.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      expect(
        (await post("reset-password", { token: first.token, newPassword }))
          .status,
      ).toBe(400);
      expect(
        await database.client.passwordResetToken.count({
          where: { userId: user.id, consumedAt: null },
        }),
      ).toBe(0);
      expect(
        (await fetch(base + "/api/auth/me", { headers: { Cookie } })).status,
      ).toBe(401);
      expect(
        (await post("login", { email: user.email, password: newPassword }))
          .status,
      ).toBe(200);
      expect(
        await database.client.auditLog.count({
          where: { actorId: user.id, action: "PASSWORD_RESET_COMPLETED" },
        }),
      ).toBe(1);
    },
  );
});
