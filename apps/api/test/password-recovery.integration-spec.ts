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
    const body = await limited.json() as { code: string; retryAfterSeconds: number };
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
      String(((await reset.json()) as { retryAfterSeconds: number }).retryAfterSeconds),
    );
  });
});
