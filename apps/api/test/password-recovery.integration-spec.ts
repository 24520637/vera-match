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
});
