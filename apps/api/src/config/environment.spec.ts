import { ConfigurationError, parseEnvironment } from "./environment";

export const localEnvironment = () => ({
  NODE_ENV: "test",
  DATABASE_URL:
    "postgresql://test_user:synthetic-only@localhost:5433/vera_test",
  MINIO_ROOT_USER: "test-access",
  MINIO_ROOT_PASSWORD: "synthetic-only-secret",
});

describe("typed environment", () => {
  it("accepts local Windows PostgreSQL and safe cookie defaults", () => {
    const config = parseEnvironment(localEnvironment());
    expect(config.session).toEqual({
      cookieName: "vera_session",
      ttlSeconds: 604800,
      secure: false,
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
    expect(config.smtp.port).toBe(1025);
    expect(new URL(config.databaseUrl).port).toBe("5433");
  });
  it.each(["API_PORT", "SMTP_PORT", "SESSION_TTL_SECONDS"])(
    "rejects malformed %s",
    (key) => {
      for (const value of ["abc", "0", "-1", "1.5", "99999999", ""])
        expect(() =>
          parseEnvironment({ ...localEnvironment(), [key]: value }),
        ).toThrow(key);
    },
  );
  it("refuses missing production secrets and never includes provided secrets in errors", () => {
    const secret = "sensitive-do-not-echo";
    try {
      parseEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: `invalid:${secret}`,
      });
      throw new Error("Expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).toContain("DATABASE_URL");
      expect(String(error)).toContain("SMTP_PASSWORD");
      expect(String(error)).toContain("MINIO_ROOT_PASSWORD");
      expect(String(error)).not.toContain(secret);
    }
  });
  it.each([
    { COOKIE_SECURE: "yes" },
    { COOKIE_SAME_SITE: "invalid" },
    { COOKIE_SECURE: "false", COOKIE_SAME_SITE: "none" },
    { COOKIE_SECURE: "false", SESSION_COOKIE_NAME: "__Host-vera_session" },
    { CORS_ORIGIN: "*" },
    { CORS_ORIGIN: "http://localhost:3000/path" },
    { SMTP_USER: "someone" },
    { SMTP_FROM: "Test\r\nInjected: yes" },
    { MINIO_ENDPOINT: "file:///private" },
  ])("rejects unsafe settings %o", (overrides) => {
    expect(() =>
      parseEnvironment({ ...localEnvironment(), ...overrides }),
    ).toThrow(ConfigurationError);
  });
  it("accepts complete production settings and enforces secure cookies", () => {
    const env = {
      ...localEnvironment(),
      NODE_ENV: "production",
      APP_BASE_URL: "https://vera.test",
      CORS_ORIGIN: "https://vera.test",
      SMTP_HOST: "mail.vera.test",
      SMTP_FROM: "VERA Match <mail@vera.test>",
      SMTP_USER: "mail-user",
      SMTP_PASSWORD: "synthetic-mail-secret",
      MINIO_ENDPOINT: "https://media.vera.test",
    };
    expect(parseEnvironment(env).session.secure).toBe(true);
    expect(() => parseEnvironment({ ...env, COOKIE_SECURE: "false" })).toThrow(
      "COOKIE_SECURE",
    );
  });
});
