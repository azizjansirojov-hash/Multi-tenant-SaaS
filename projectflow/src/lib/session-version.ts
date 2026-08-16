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

/** Max seconds after last Node sessionVersion check before Edge bounces to revalidate. */
export const SESSION_VERSION_MAX_STALE_SECONDS = 60;

export const SESSION_REVALIDATE_PATH = "/api/session/revalidate";

export function nowSessionCheckedAt(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000);
}

/**
 * Edge-safe JWT gate for middleware (no DB). Prisma/`pg` cannot run on the
 * Next.js Edge runtime used by `middleware.ts`, and this app has no KV/cache
 * to look up `User.sessionVersion` per request.
 *
 * Middleware therefore only rejects tokens that are missing, expired
 * (handled by `getToken`), already stamped `SessionInvalidated`, or lacking
 * a numeric `sessionVersion` claim. Authoritative invalidation vs the DB
 * happens in the Auth.js `jwt` callback and `requireMembership` (Node).
 */
export function isEdgeJwtStructurallyValid(token: {
  sub?: string;
  sessionVersion?: unknown;
  error?: string;
} | null): boolean {
  if (!token?.sub) return false;
  if (token.error === "SessionInvalidated") return false;
  if (typeof token.sessionVersion !== "number") return false;
  return true;
}

/**
 * True when Node last confirmed sessionVersion within the staleness window.
 * Missing sessionCheckedAt is treated as stale so pre-claim cookies bounce
 * to the Node revalidate route.
 */
export function isEdgeJwtFresh(
  token: { sessionCheckedAt?: unknown } | null,
  nowSeconds: number = nowSessionCheckedAt(),
  maxStaleSeconds: number = SESSION_VERSION_MAX_STALE_SECONDS
): boolean {
  if (typeof token?.sessionCheckedAt !== "number") return false;
  if (!Number.isFinite(token.sessionCheckedAt)) return false;
  return nowSeconds - token.sessionCheckedAt <= maxStaleSeconds;
}
