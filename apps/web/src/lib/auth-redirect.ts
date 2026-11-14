/** Only implemented member destinations are allowed; extend deliberately with future protected routes. */
export function safeNextPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return "/account";
  try {
    const url = new URL(value, "https://vera.invalid");
    return url.origin === "https://vera.invalid" && url.pathname === "/account"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/account";
  } catch {
    return "/account";
  }
}
