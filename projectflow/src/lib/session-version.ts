/**
 * Pure check used by Auth.js jwt callback and tests.
 * A JWT is valid only when its embedded version matches the DB value.
 */
export function isSessionVersionValid(
  tokenVersion: unknown,
  dbVersion: number | null | undefined
): boolean {
  if (dbVersion == null) return false;
  if (typeof tokenVersion !== "number") return false;
  return tokenVersion === dbVersion;
}
