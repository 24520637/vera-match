import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/configure-app";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import { PasswordService } from "../src/auth/password.service";
import { hashSessionToken } from "../src/auth/session-token";
import { createAuthDatabase } from "./disposable-auth-database";

/** Real application/login/session guard, synthetic accounts in a disposable schema.
 * Default policy, evidence and MFA providers stay closed. No success auth handler.
 */
export async function securityHarness(bucket?: string) {
  const db = await createAuthDatabase();
  const origin = "http://localhost:3000";
  const values = parseEnvironment({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: db.url,
    CORS_ORIGIN: origin,
    ...(bucket ? { MINIO_BUCKET: bucket } : {}),
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EnvironmentService)
    .useValue({ values })
    .overrideProvider(PrismaService)
    .useValue(db.client)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  try {
    await app.listen(0, "127.0.0.1");
  } catch (error) {
    await app.close();
    await db.close();
    throw error;
  }
  const base = await app.getUrl();
  const request = (
    cookie: string,
    path: string,
    body?: unknown,
    method = "POST",
    extra: Record<string, string> = {},
  ) =>
    fetch(base + "/api/" + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
        ...extra,
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  async function login(email: string, password: string, cookie = "") {
    const response = await request(cookie, "auth/login", { email, password });
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie")!;
    const sessionCookie = header.split(";")[0];
    const token = sessionCookie.slice(sessionCookie.indexOf("=") + 1);
    const session = await db.client.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(token) },
    });
    return { cookie: sessionCookie, token, sessionId: session.id, header };
  }
  async function account(role: UserRole = "MEMBER") {
    const password = "synthetic-security-regression-password";
    const row = await db.client.user.create({
      data: {
        email: randomUUID() + "@example.invalid",
        role,
        status: "ACTIVE",
        declaredAdult: true,
        emailVerifiedAt: new Date(),
        passwordHash: await app.get(PasswordService).hash(password),
      },
    });
    return { ...row, password, ...(await login(row.email, password)) };
  }
  return {
    app,
    db,
    values,
    base,
    origin,
    request,
    login,
    account,
    async close() {
      try {
        await app.close();
      } finally {
        await db.close();
      }
    },
  };
}
export type SecurityHarness = Awaited<ReturnType<typeof securityHarness>>;
