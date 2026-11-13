const KEY = "vera.rememberedEmail";
type EmailStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readRememberedEmail(storage: EmailStorage): {
  email: string;
  available: boolean;
} {
  try {
    const email = storage.getItem(KEY) ?? "";
    return {
      email:
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
          ? email
          : "",
      available: true,
    };
  } catch {
    return { email: "", available: false };
  }
}
export function rememberEmail(
  storage: EmailStorage,
  email: string,
  enabled: boolean,
): boolean {
  try {
    if (enabled) storage.setItem(KEY, email.trim().toLowerCase());
    else storage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
