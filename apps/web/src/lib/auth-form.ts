import { ApiError } from "./api";
export function authFieldErrors(
  error: unknown,
  prefix: string,
  fields: string[],
): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  return Object.fromEntries(
    error.details
      .filter(
        (detail) =>
          fields.includes(detail.field) && Array.isArray(detail.messages),
      )
      .map((detail) => [
        `${prefix}-${detail.field}`,
        detail.messages
          .filter((message) => typeof message === "string")
          .join(" "),
      ]),
  );
}
export function authErrorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "The request could not be completed. Try again.";
}
