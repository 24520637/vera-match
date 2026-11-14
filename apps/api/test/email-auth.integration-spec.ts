import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { AuthRateLimiter } from "../src/auth/auth-request.guard";
import { createServer } from "node:net";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { configureApplication } from "../src/configure-app";
import { hashVerificationToken } from "../src/auth/verification.service";
import { hashSessionToken } from "../src/auth/session-token";
import { createAuthDatabase } from "./disposable-auth-database";
import {
  clearTestEmails,
  findTestEmails,
  readActivationEmail,
} from "./mailpit-fixtures";

describe("email authentication HTTP / PostgreSQL / native SMTP", () => {
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
    const email = `auth-${randomUUID()}@example.invalid`;
    recipients.push(email);
    return email;
  };
  const post = (
    path: string,
    body: object,
    requestOrigin?: string,
    cookie?: string,
  ) =>
    fetch(`${base}/api/auth/${path}`, {
      method: "POST",
      headers: {
        Origin: requestOrigin ?? origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  it("validates registration, persists a pending hash, sends a real email and does not overwrite duplicates", async () => {
    const email = newEmail();
    const valid = {
      email: email.toUpperCase(),
      password: "synthetic-register-password",
      declaredAdult: true,
    };
    expect(
      (await post("register", { ...valid, declaredAdult: false })).status,
    ).toBe(400);
    expect(
      (await post("register", valid, "https://attacker.invalid")).status,
    ).toBe(403);
    const before = Date.now();
    const response = await post("register", valid);
    expect(response.status).toBe(202);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const firstBody = await response.json();
    const user = await database.client.user.findUniqueOrThrow({
      where: { email },
    });
    expect(user).toMatchObject({
      status: "PENDING_EMAIL",
      emailVerifiedAt: null,
      declaredAdult: true,
      role: "MEMBER",
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toBe(valid.password);
    const activation = await readActivationEmail(email);
    const row = await database.client.emailVerificationToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.tokenHash).toBe(hashVerificationToken(activation.token));
    expect(row.tokenHash).not.toBe(activation.token);
    expect(row.expiresAt.getTime()).toBeGreaterThan(before + 59000);
    expect(new URL(activation.link).search).toBe("");
    const duplicate = await post("register", {
      ...valid,
      password: "another-synthetic-password",
    });
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual(firstBody);
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { email } }))
        .passwordHash,
    ).toBe(user.passwordHash);
    expect(await database.client.user.count({ where: { email } })).toBe(1);
    expect(
      await database.client.session.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("consumes activation once under concurrent verification, without creating a session", async () => {
    const email = newEmail();
    expect(
      (
        await post("register", {
          email,
          password: "synthetic-password-123",
          declaredAdult: true,
        })
      ).status,
    ).toBe(202);
    const activation = await readActivationEmail(email);
    const responses = await Promise.all([
      post("verify-email", { token: activation.token }),
      post("verify-email", { token: activation.token }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    const user = await database.client.user.findUniqueOrThrow({
      where: { email },
    });
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(
      await database.client.session.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      (await post("verify-email", { token: activation.token })).status,
    ).toBe(400);
  });

  it("rejects unknown, expired and suspended activation without activating the account", async () => {
    expect((await post("verify-email", { token: "a".repeat(43) })).status).toBe(
      400,
    );
    const email = newEmail();
    await post("register", {
      email,
      password: "synthetic-password-123",
      declaredAdult: true,
    });
    const activation = await readActivationEmail(email);
    await database.client.emailVerificationToken.update({
      where: { tokenHash: hashVerificationToken(activation.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await post("verify-email", { token: activation.token })).status,
    ).toBe(400);
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { email } }))
        .status,
    ).toBe("PENDING_EMAIL");
    await database.client.emailVerificationToken.update({
      where: { tokenHash: hashVerificationToken(activation.token) },
      data: { expiresAt: new Date(Date.now() + 60000) },
    });
    await database.client.user.update({
      where: { email },
      data: { status: "SUSPENDED" },
    });
    expect(
      (await post("verify-email", { token: activation.token })).status,
    ).toBe(400);
    expect(
      (
        await database.client.emailVerificationToken.findUniqueOrThrow({
          where: { tokenHash: hashVerificationToken(activation.token) },
        })
      ).consumedAt,
    ).toBeNull();
  });

  it("resends with a cooldown, invalidates old links, and uses generic unknown/suspended responses", async () => {
    const email = newEmail();
    const unknown = newEmail();
    await post("register", {
      email,
      password: "synthetic-password-123",
      declaredAdult: true,
    });
    const first = await readActivationEmail(email);
    const unknownResponse = await post("resend-verification", {
      email: unknown,
    });
    expect(unknownResponse.status).toBe(202);
    const generic = await unknownResponse.json();
    expect(await (await post("resend-verification", { email })).json()).toEqual(
      generic,
    );
    expect((await findTestEmails(email)).length).toBe(1);
    const user = await database.client.user.findUniqueOrThrow({
      where: { email },
    });
    await database.client.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    const resends = await Promise.all([
      post("resend-verification", { email }),
      post("resend-verification", { email }),
    ]);
    expect(resends.map((response) => response.status)).toEqual([202, 202]);
    const second = await readActivationEmail(email, [first.id]);
    expect((await findTestEmails(email)).length).toBe(2);
    expect((await post("verify-email", { token: first.token })).status).toBe(
      400,
    );
    expect((await post("verify-email", { token: second.token })).status).toBe(
      200,
    );
    await database.client.user.update({
      where: { id: user.id },
      data: { status: "SUSPENDED" },
    });
    expect(await (await post("resend-verification", { email })).json()).toEqual(
      generic,
    );
    expect((await findTestEmails(email)).length).toBe(2);
  });

  it("issues persistent HttpOnly cookies only after real credential and activation checks", async () => {
    const email = newEmail();
    const password = "synthetic-login-password";
    await post("register", { email, password, declaredAdult: true });
    const pending = await post("login", { email, password });
    expect(pending.status).toBe(401);
    expect(pending.headers.get("set-cookie")).toBeNull();
    const activation = await readActivationEmail(email);
    await post("verify-email", { token: activation.token });
    expect(
      (await post("login", { email, password: "wrong-synthetic-password" }))
        .status,
    ).toBe(401);
    expect((await post("login", { email: newEmail(), password })).status).toBe(
      401,
    );
    const loggedIn = await post("login", {
      email: email.toUpperCase(),
      password,
    });
    expect(loggedIn.status).toBe(200);
    const cookie = loggedIn.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).not.toContain("Domain=");
    const token = cookie.split(";")[0].split("=")[1];
    const body = await loggedIn.json();
    expect(body).toMatchObject({ email, role: "MEMBER" });
    expect(Object.keys(body as object).sort()).toEqual([
      "displayName",
      "email",
      "id",
      "role",
    ]);
    const session = await database.client.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(session.tokenHash).not.toBe(token);
    await database.client.user.update({
      where: { email },
      data: { status: "SUSPENDED" },
    });
    expect((await post("login", { email, password })).status).toBe(401);
    await database.client.user.update({
      where: { email },
      data: { status: "DELETED" },
    });
    expect((await post("login", { email, password })).status).toBe(401);
    expect(
      await database.client.session.count({
        where: { userId: session.userId },
      }),
    ).toBe(1);
  });

  it("restores only a valid live session and returns the minimal current-user projection", async () => {
    const email = newEmail();
    const password = "synthetic-session-password";
    await post("register", { email, password, declaredAdult: true });
    const activation = await readActivationEmail(email);
    await post("verify-email", { token: activation.token });
    const login = await post("login", { email, password });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const me = (value?: string) =>
      fetch(`${base}/api/auth/me`, { headers: value ? { Cookie: value } : {} });
    expect((await me()).status).toBe(401);
    expect((await me("vera_session=invalid")).status).toBe(401);
    const response = await me(cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const user = (await response.json()) as { id: string };
    expect(Object.keys(user).sort()).toEqual([
      "displayName",
      "email",
      "id",
      "role",
    ]);
    const session = await database.client.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    await database.client.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await me(cookie)).status).toBe(401);
    await database.client.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() },
    });
    expect((await me(cookie)).status).toBe(401);
  });

  it("revokes one or all owned sessions, clears the exact cookie and leaves other accounts untouched", async () => {
    const email = newEmail();
    const password = "synthetic-logout-password";
    await post("register", { email, password, declaredAdult: true });
    const activation = await readActivationEmail(email);
    await post("verify-email", { token: activation.token });
    const signIn = async (address = email) =>
      (await post("login", { email: address, password })).headers
        .get("set-cookie")!
        .split(";")[0];
    const first = await signIn();
    const second = await signIn();
    const me = (cookie: string) =>
      fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    const logout = await post("logout", {}, origin, first);
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Path=/");
    expect(logout.headers.get("set-cookie")).toContain("Expires=");
    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
    expect((await post("logout", {}, origin, first)).status).toBe(204);
    const other = newEmail();
    await post("register", { email: other, password, declaredAdult: true });
    const otherActivation = await readActivationEmail(other);
    await post("verify-email", { token: otherActivation.token });
    const otherCookie = await signIn(other);
    expect(
      (await post("logout-all", {}, "https://attacker.invalid", second)).status,
    ).toBe(403);
    expect((await me(second)).status).toBe(200);
    expect((await post("logout-all", {}, origin, second)).status).toBe(204);
    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(401);
    expect((await me(otherCookie)).status).toBe(200);
    expect((await post("logout", {})).status).toBe(204);
  });

  it("rejects missing/foreign origins, non-JSON requests and privileged registration fields", async () => {
    for (const route of [
      "register",
      "verify-email",
      "resend-verification",
      "login",
      "logout",
      "logout-all",
    ]) {
      expect(
        (
          await fetch(`${base}/api/auth/${route}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect((await post(route, {}, "https://attacker.invalid")).status).toBe(
        403,
      );
      expect(
        (
          await fetch(`${base}/api/auth/${route}`, {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "text/plain" },
            body: "{}",
          })
        ).status,
      ).toBe(415);
    }
    const email = newEmail();
    expect(
      (
        await post("register", {
          email,
          password: "synthetic-password-123",
          declaredAdult: true,
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(await database.client.user.count({ where: { email } })).toBe(0);
    expect((await post("logout-all", {})).status).toBe(401);
  });

  it("limits repeated attempts without performing account creation or email delivery", async () => {
    for (let count = 0; count < 20; count++)
      expect((await post("register", {})).status).toBe(400);
    const limited = await post("register", {});
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(limited.headers.get("access-control-expose-headers")).toContain(
      "Retry-After",
    );
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(await limited.json()).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: Number(limited.headers.get("retry-after")),
    });
    for (let count = 0; count < 10; count++)
      expect((await post("login", { email: "not-an-email" })).status).toBe(400);
    expect((await post("login", { email: "not-an-email" })).status).toBe(429);
  });

  it("blocks active-but-unverified accounts and invalidates existing sessions after account suspension", async () => {
    const email = newEmail();
    const password = "synthetic-policy-password";
    await post("register", { email, password, declaredAdult: true });
    await database.client.user.update({
      where: { email },
      data: { status: "ACTIVE" },
    });
    expect((await post("login", { email, password })).status).toBe(401);
    await database.client.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
    });
    const response = await post("login", { email, password });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    await database.client.user.update({
      where: { email },
      data: { status: "SUSPENDED" },
    });
    expect(
      (await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401);
    expect((await post("logout-all", {}, origin, cookie)).status).toBe(401);
  });

  it("reports real SMTP connection failure without issuing a session or leaving a usable activation token", async () => {
    const failingSmtp = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      failingSmtp.listen(0, "127.0.0.1", resolve),
    );
    try {
      await app.close();
      const address = failingSmtp.address();
      if (!address || typeof address === "string")
        throw new Error("Synthetic SMTP port unavailable");
      const values = parseEnvironment({
        ...process.env,
        DATABASE_URL: database.url,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(address.port),
        SMTP_SECURE: "false",
        SMTP_REQUIRE_TLS: "false",
        SMTP_USER: "",
        SMTP_PASSWORD: "",
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EnvironmentService)
        .useValue({ values })
        .compile();
      app = module.createNestApplication({ logger: false });
      configureApplication(app);
      await app.listen(0, "127.0.0.1");
      base = await app.getUrl();
      const email = newEmail();
      const response = await post("register", {
        email,
        password: "synthetic-smtp-password",
        declaredAdult: true,
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "EMAIL_DELIVERY_UNAVAILABLE",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
      const user = await database.client.user.findUniqueOrThrow({
        where: { email },
      });
      expect(user.status).toBe("PENDING_EMAIL");
      expect(
        await database.client.emailVerificationToken.count({
          where: { userId: user.id, consumedAt: null },
        }),
      ).toBe(0);
      expect(
        await database.client.session.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect((await findTestEmails(email)).length).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        failingSmtp.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("uses the socket IP directly and through a real untrusted proxy; forged forwarded IPs cannot reset limits", async () => {
    const seen = jest.spyOn(app.get(AuthRateLimiter), "consume");
    const proxy = createHttpServer((incoming, outgoing) => {
      const upstream = httpRequest(
        new URL(incoming.url ?? "/", base),
        {
          method: incoming.method,
          headers: {
            ...incoming.headers,
            "x-forwarded-for":
              incoming.headers["x-forwarded-for"] ?? "198.51.100.22",
          },
        },
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
      const address = proxy.address();
      if (!address || typeof address === "string")
        throw new Error("Proxy port unavailable");
      for (let count = 0; count < 20; count++) {
        const target = count % 2 ? "http://127.0.0.1:" + address.port : base;
        const response = await fetch(target + "/api/auth/register", {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            "X-Forwarded-For": "203.0.113." + (count + 1),
            "X-Real-IP": "192.0.2.99",
            Forwarded: "for=192.0.2.99",
          },
          body: "{}",
        });
        expect(response.status).toBe(400);
      }
      expect(
        seen.mock.calls
          .filter((call) => call[0] === "register:ip")
          .every((call) => call[1] === "127.0.0.1"),
      ).toBe(true);
      const limited = await fetch(
        "http://127.0.0.1:" + address.port + "/api/auth/register",
        {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            "X-Forwarded-For": "192.0.2.123",
          },
          body: "{}",
        },
      );
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    } finally {
      seen.mockRestore();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
