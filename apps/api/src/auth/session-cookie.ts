import type { CookieOptions } from "express";
import type { AppConfiguration } from "../config/environment";
export function sessionCookieOptions(
  config: AppConfiguration,
  persistent = true,
): CookieOptions {
  return {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    path: "/",
    ...(persistent ? { maxAge: config.session.ttlSeconds * 1000 } : {}),
  };
}
