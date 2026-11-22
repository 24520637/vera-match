import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
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
export async function securityHarness(bucket?: string, isolatedClients = false) {
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
  let loginClient = 0;
  const cookieClients = new Map<string, string>();
  async function loopbackRequest(address: string, cookie: string, path: string, input: unknown, method: string, extra: Record<string, string> = {}) {
    const body = method === "GET" ? undefined : JSON.stringify(input ?? {});
    return new Promise<Response>((resolve, reject) => {
      const outgoing = httpRequest(base + "/api/" + path, {
        method, localAddress: address,
        headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": randomUUID(),
          ...(body === undefined ? {} : { "Content-Length": Buffer.byteLength(body) }), ...extra },
      }, incoming => {
        const chunks: Buffer[] = []; let size = 0;
        incoming.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 65536) outgoing.destroy(Error("Fixture response limit")); else chunks.push(chunk); });
        incoming.on("end", () => {
          const headers = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2)
            headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
          resolve(new Response([204, 205, 304].includes(incoming.statusCode!) ? null : Buffer.concat(chunks), { status: incoming.statusCode!, headers }));
        });
      });
      outgoing.on("error", reject); outgoing.setTimeout(10000, () => outgoing.destroy(Error("Fixture connection timeout"))); outgoing.end(body);
    });
  }
  const request = (
    cookie: string,
    path: string,
    body?: unknown,
    method = "POST",
    extra: Record<string, string> = {},
  ) =>
    isolatedClients && cookieClients.has(cookie) ? loopbackRequest(cookieClients.get(cookie)!, cookie, path, body, method, extra) :
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
    const number = loginClient++;
    if (number > 60000) throw Error("Synthetic client capacity exceeded");
    const address = "127.77." + Math.floor(number / 254) + "." + (number % 254 + 1);
    const response = isolatedClients ? await loopbackRequest(address, cookie, "auth/login", { email, password }, "POST")
      : await request(cookie, "auth/login", { email, password });
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie")!;
    const sessionCookie = header.split(";")[0];
    if (isolatedClients) cookieClients.set(sessionCookie, address);
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
