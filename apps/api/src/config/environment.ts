export interface AppConfiguration {
  readonly verification: { readonly ttlSeconds: number };
  readonly nodeEnv: "development" | "test" | "production";
  readonly apiPort: number;
  readonly databaseUrl: string;
  readonly appBaseUrl: string;
  readonly corsOrigin: string;
  readonly session: {
    readonly cookieName: string;
    readonly ttlSeconds: number;
    readonly secure: boolean;
    readonly sameSite: "lax" | "strict" | "none";
    readonly httpOnly: true;
    readonly path: "/";
  };
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly from: string;
    readonly secure: boolean;
    readonly requireTls: boolean;
    readonly user?: string;
    readonly password?: string;
  };
  readonly minio: {
    readonly endpoint: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly bucket: string;
  };
  readonly password: {
    readonly memoryCost: number;
    readonly timeCost: number;
    readonly parallelism: number;
  };
}

export class ConfigurationError extends Error {
  constructor(issues: string[]) {
    super(`Invalid API configuration: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
  }
}

/** Diagnostics intentionally include variable names and constraints, never supplied values. */
export function parseEnvironment(
  env: Record<string, unknown>,
): AppConfiguration {
  const issues: string[] = [];
  const read = (key: string, fallback = "") =>
    typeof env[key] === "string" ? (env[key] as string).trim() : fallback;
  const nodeEnv = read("NODE_ENV", "development");
  if (!["development", "test", "production"].includes(nodeEnv))
    issues.push("NODE_ENV must be development, test or production");
  const production = nodeEnv === "production";
  function integer(key: string, fallback: number, min: number, max: number) {
    const raw = read(key, String(fallback));
    const value = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      issues.push(`${key} must be an integer between ${min} and ${max}`);
    return value;
  }
  function boolean(key: string, fallback: boolean) {
    const raw = read(key, String(fallback));
    if (raw !== "true" && raw !== "false")
      issues.push(`${key} must be true or false`);
    return raw === "true";
  }
  function secret(key: string, localDefault = "", min = 1) {
    const value = read(key, production ? "" : localDefault);
    if (
      value.length < min ||
      (production &&
        /change.?me|change.?this|example|placeholder|vera_dev|your_|replace_/i.test(value))
    )
      issues.push(
        `${key} requires a non-placeholder secret of at least ${min} characters`,
      );
    return value;
  }
  function origin(key: string, fallback: string) {
    const raw = read(key, production ? "" : fallback);
    try {
      const url = new URL(raw);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        (production && url.protocol !== "https:")
      )
        throw new Error();
      return url.origin;
    } catch {
      issues.push(
        `${key} must be a single HTTP(S) origin (HTTPS in production)`,
      );
      return "";
    }
  }
  const databaseUrl = read("DATABASE_URL");
  try {
    const url = new URL(databaseUrl);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      (production &&
        /change.?me|vera_dev|your_|replace_/i.test(decodeURIComponent(url.password)))
    )
      throw new Error();
  } catch {
    issues.push(
      "DATABASE_URL requires a PostgreSQL URL with database name and credentials",
    );
  }
  const cookieName = read(
    "SESSION_COOKIE_NAME",
    production ? "__Host-vera_session" : "vera_session",
  );
  if (!/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(cookieName))
    issues.push("SESSION_COOKIE_NAME must be a valid cookie name");
  const secure = boolean("COOKIE_SECURE", production);
  const sameSite = read("COOKIE_SAME_SITE", "lax");
  if (!["lax", "strict", "none"].includes(sameSite))
    issues.push("COOKIE_SAME_SITE must be lax, strict or none");
  if (
    (production ||
      sameSite === "none" ||
      cookieName.startsWith("__Host-") ||
      cookieName.startsWith("__Secure-")) &&
    !secure
  )
    issues.push(
      "COOKIE_SECURE must be true for production, SameSite=None and prefixed cookies",
    );
  const smtpUser = read("SMTP_USER");
  const smtpPassword = read("SMTP_PASSWORD");
  if (!!smtpUser !== !!smtpPassword)
    issues.push("SMTP_USER and SMTP_PASSWORD must be supplied together");
  if (production) {
    secret("SMTP_USER");
    secret("SMTP_PASSWORD", "", 16);
  }
  const smtpHost = read("SMTP_HOST", production ? "" : "localhost");
  if (!smtpHost || /[\s/\\]/.test(smtpHost))
    issues.push("SMTP_HOST requires a hostname");
  const smtpFrom = read(
    "SMTP_FROM",
    production ? "" : "VERA Match <noreply@localhost.test>",
  );
  if (
    /[\r\n]/.test(smtpFrom) ||
    !/^[^<>]*<?[^\s<>@]+@[^\s<>@]+>?$/.test(smtpFrom)
  )
    issues.push("SMTP_FROM requires a sender address without line breaks");
  const smtpSecure = boolean("SMTP_SECURE", production);
  const requireTls = boolean("SMTP_REQUIRE_TLS", production);
  if (production && !smtpSecure && !requireTls)
    issues.push("SMTP requires TLS in production");
  const minioEndpoint = read(
    "MINIO_ENDPOINT",
    production ? "" : "http://localhost:9000",
  );
  try {
    const url = new URL(minioEndpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (production && url.protocol !== "https:")
    )
      throw new Error();
  } catch {
    issues.push(
      "MINIO_ENDPOINT requires an HTTP(S) origin (HTTPS in production)",
    );
  }
  const bucket = read("MINIO_BUCKET", "vera-private");
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes("..")
  )
    issues.push("MINIO_BUCKET must be a valid bucket name");
  const config: AppConfiguration = {
    verification: { ttlSeconds: integer('VERIFICATION_TTL_SECONDS', 1800, 60, 86400) },
    nodeEnv: nodeEnv as AppConfiguration["nodeEnv"],
    apiPort: integer("API_PORT", 4000, 1, 65535),
    databaseUrl,
    appBaseUrl: origin("APP_BASE_URL", "http://localhost:3000"),
    corsOrigin: origin("CORS_ORIGIN", "http://localhost:3000"),
    session: {
      cookieName,
      ttlSeconds: integer("SESSION_TTL_SECONDS", 604800, 60, 2592000),
      secure,
      sameSite: sameSite as AppConfiguration["session"]["sameSite"],
      httpOnly: true,
      path: "/",
    },
    smtp: {
      host: smtpHost,
      port: integer("SMTP_PORT", 1025, 1, 65535),
      from: smtpFrom,
      secure: smtpSecure,
      requireTls,
      user: smtpUser || undefined,
      password: smtpPassword || undefined,
    },
    minio: {
      endpoint: minioEndpoint,
      accessKey: secret("MINIO_ROOT_USER", "", 3),
      secretKey: secret("MINIO_ROOT_PASSWORD", "", 8),
      bucket,
    },
    password: {
      memoryCost: integer("ARGON2_MEMORY_COST_KIB", 65536, 19456, 262144),
      timeCost: integer("ARGON2_TIME_COST", 3, 2, 10),
      parallelism: integer("ARGON2_PARALLELISM", 1, 1, 4),
    },
  };
  if (issues.length) throw new ConfigurationError(issues);
  return config;
}

export function validateEnvironment(env: Record<string, unknown>) {
  return { ...env, app: parseEnvironment(env) };
}
