import { Controller, Get, INestApplication, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccountStatus, PrismaClient, UserRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { AppModule } from "../src/app.module";
import { AuthModule } from "../src/auth/auth.module";
import { CurrentUser } from "../src/auth/current-user.decorator";
import { CurrentUser as CurrentUserContext } from "../src/auth/auth-context";
import { Roles, RolesGuard } from "../src/auth/roles.guard";
import { SessionAuthGuard } from "../src/auth/session-auth.guard";
import { SessionService } from "../src/auth/session.service";
import { EnvironmentService } from "../src/config/environment.service";
import { PrismaService } from "../src/database/prisma.service";
import { withAuthFixtures } from "./auth-fixtures";

// Test-only HTTP routes. Production AppModule never registers this controller.
@Controller("__t01_fixture")
@UseGuards(SessionAuthGuard)
class ProtectedFixtureController {
  @Get("member")
  member(@CurrentUser() user: CurrentUserContext) {
    return user;
  }

  @Get("admin")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  admin(@CurrentUser() user: CurrentUserContext) {
    return { id: user.id };
  }
}

describe("T01 real PostgreSQL 18 / HTTP smoke", () => {
  let client: PrismaClient;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (
      process.env.NODE_ENV !== "test" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.port !== "5433"
    )
      throw new Error(
        "Integration smoke requires NODE_ENV=test and local PostgreSQL on port 5433",
      );
    client = new PrismaClient({
      datasources: { db: { url: url.toString() } },
      log: [],
    });
    await client.$connect();
    const [{ version }] = await client.$queryRaw<
      { version: string }[]
    >`SELECT current_setting('server_version_num') AS version`;
    expect(Number(version)).toBeGreaterThanOrEqual(180000);
    expect(Number(version)).toBeLessThan(190000);
  });
  afterAll(async () => {
    await client?.$disconnect();
  });

  async function requestFixture(
    run: (
      app: INestApplication,
      fixture: Parameters<Parameters<typeof withAuthFixtures>[1]>[0],
      request: (path: string, cookie?: string) => Promise<Response>,
    ) => Promise<void>,
  ) {
    await withAuthFixtures(client, async (fixture) => {
      const module = await Test.createTestingModule({
        imports: [AppModule, AuthModule],
        controllers: [ProtectedFixtureController],
      })
        .overrideProvider(PrismaService)
        .useValue(fixture.tx)
        .compile();
      const app = module.createNestApplication({ logger: false });
      app.setGlobalPrefix("api");
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const request = (path: string, cookie?: string) =>
        fetch(`${base}/api${path}`, {
          headers: cookie ? { Cookie: cookie } : {},
        });
      try {
        await run(app, fixture, request);
      } finally {
        await app.close();
      }
    });
  }

  it("keeps a default pending user unauthenticated despite an inserted session", async () => {
    await requestFixture(async (app, fixture, request) => {
      const name = app.get(EnvironmentService).values.session.cookieName;
      const response = await request(
        "/__t01_fixture/member",
        `${name}=${fixture.token}`,
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    });
  });

  it("authenticates a verified active member through the real DB and returns no secrets", async () => {
    await requestFixture(async (app, fixture, request) => {
      await fixture.tx.user.update({
        where: { id: fixture.userId },
        data: { status: "ACTIVE", emailVerifiedAt: new Date() },
      });
      const cookie = `${app.get(EnvironmentService).values.session.cookieName}=${fixture.token}`;
      const response = await request("/__t01_fixture/member", cookie);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: fixture.userId,
        email: `${fixture.userId}@example.invalid`,
        displayName: null,
        role: "MEMBER",
      });
      expect(
        (
          await fixture.tx.session.findUniqueOrThrow({
            where: { id: fixture.sessionId },
          })
        ).tokenHash,
      ).toBe(fixture.tokenHash);
      expect(fixture.tokenHash).not.toBe(fixture.token);
      expect((await request("/__t01_fixture/admin", cookie)).status).toBe(403);
      await fixture.tx.user.update({
        where: { id: fixture.userId },
        data: { role: "ADMIN" },
      });
      expect((await request("/__t01_fixture/admin", cookie)).status).toBe(200);
    });
  });

  it("denies missing, altered, malformed and duplicate cookies with HTTP 401", async () => {
    await requestFixture(async (app, fixture, request) => {
      await fixture.tx.user.update({
        where: { id: fixture.userId },
        data: { status: "ACTIVE", emailVerifiedAt: new Date() },
      });
      const name = app.get(EnvironmentService).values.session.cookieName;
      for (const cookie of [
        undefined,
        `${name}=bad`,
        `${name}=${randomBytes(32).toString("base64url")}`,
        `${name}=${fixture.token}; ${name}=${fixture.token}`,
      ])
        expect((await request("/__t01_fixture/member", cookie)).status).toBe(
          401,
        );
    });
  });

  it.each(["expired", "revoked", "unverified", "suspended", "deleted"])(
    "rechecks %s state from DB on every request",
    async (state) => {
      await requestFixture(async (app, fixture, request) => {
        await fixture.tx.user.update({
          where: { id: fixture.userId },
          data: { status: "ACTIVE", emailVerifiedAt: new Date() },
        });
        const cookie = `${app.get(EnvironmentService).values.session.cookieName}=${fixture.token}`;
        expect((await request("/__t01_fixture/member", cookie)).status).toBe(
          200,
        );
        if (state === "expired")
          await fixture.tx.session.update({
            where: { id: fixture.sessionId },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
        if (state === "revoked")
          await fixture.tx.session.update({
            where: { id: fixture.sessionId },
            data: { revokedAt: new Date() },
          });
        if (state === "unverified")
          await fixture.tx.user.update({
            where: { id: fixture.userId },
            data: { emailVerifiedAt: null },
          });
        if (state === "suspended" || state === "deleted")
          await fixture.tx.user.update({
            where: { id: fixture.userId },
            data: { status: state.toUpperCase() as AccountStatus },
          });
        expect((await request("/__t01_fixture/member", cookie)).status).toBe(
          401,
        );
      });
    },
  );

  it("reports real readiness and calls disconnect when the application closes", async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
    const prisma = app.get(PrismaService);
    const disconnect = jest.spyOn(prisma, "$disconnect");
    try {
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
      const ready = await fetch(`${base}/api/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({ database: "ok" });
      expect((await fetch(`${base}/api/__t01_fixture/member`)).status).toBe(
        404,
      );
    } finally {
      await app.close();
    }
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("returns sanitized 503 for a disconnected database, not 401", async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.port = "1";
    url.searchParams.set("connect_timeout", "1");
    const values = { databaseUrl: url.toString() };
    const unavailable = new PrismaService({ values } as EnvironmentService);
    try {
      await expect(unavailable.readiness()).rejects.toMatchObject({
        status: 503,
      });
      await expect(
        new SessionService(unavailable).resolve(
          randomBytes(32).toString("base64url"),
        ),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      await unavailable.$disconnect();
    }
  });

  it("isolates repeated fixture runs and rolls back even when an assertion throws", async () => {
    await withAuthFixtures(client, async () => undefined);
    await withAuthFixtures(client, async () => undefined);
    await expect(
      withAuthFixtures(client, async () => {
        throw new Error("synthetic test failure");
      }),
    ).rejects.toThrow("synthetic test failure");
  });
});
