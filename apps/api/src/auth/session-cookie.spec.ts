import { parseEnvironment } from "../config/environment";
import { sessionCookieOptions } from "./session-cookie";
describe("session cookie contract", () => {
  const config = parseEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:synthetic@localhost:5433/test",
    MINIO_ROOT_USER: "synthetic",
    MINIO_ROOT_PASSWORD: "synthetic-only",
  });
  it("uses persistent HttpOnly host-only cookies and exact clear-cookie scope", () => {
    expect(sessionCookieOptions(config)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 604800000,
    });
    expect(sessionCookieOptions(config, false)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
  });
  it("preserves secure production flags", () =>
    expect(
      sessionCookieOptions({
        ...config,
        session: {
          ...config.session,
          secure: true,
          cookieName: "__Host-vera_session",
          sameSite: "strict",
        },
      }),
    ).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    }));
});
