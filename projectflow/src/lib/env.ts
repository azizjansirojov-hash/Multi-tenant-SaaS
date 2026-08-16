/**
 * Process env helpers. Keep this module free of Prisma / bcrypt so it can
 * be imported from instrumentation and Next config-adjacent code.
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function parseAuthTrustHostRaw(): boolean | null {
  const raw = process.env.AUTH_TRUST_HOST?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  return null;
}

/**
 * Whether Auth.js should trust X-Forwarded-Host / X-Forwarded-Proto.
 *
 * Production: AUTH_TRUST_HOST must be an explicit boolean (true/false/1/0).
 * Unset or invalid values throw — fail closed, never silently default to true.
 * Development/test: unset or invalid → true (local DX / reverse-proxy).
 */
export function authTrustHost(): boolean {
  const parsed = parseAuthTrustHostRaw();
  if (parsed !== null) return parsed;
  if (isProduction()) {
    throw new Error(
      "AUTH_TRUST_HOST must be set to true or false in production (controls trust of X-Forwarded-Host / X-Forwarded-Proto from the reverse proxy)"
    );
  }
  return true;
}

/**
 * How many reverse proxies sit in front of the app and overwrite
 * X-Forwarded-For. Default 0: ignore forwarded headers (anti-spoof).
 * Invalid or negative values are treated as 0.
 */
export function trustedProxyCount(): number {
  const raw = process.env.TRUSTED_PROXY_COUNT?.trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function s3Configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );
}

export function assertRequiredEnv(): void {
  const missing: string[] = [];
  if (!process.env.AUTH_SECRET?.trim()) missing.push("AUTH_SECRET");
  if (!process.env.DATABASE_URL?.trim()) missing.push("DATABASE_URL");
  if (isProduction() && parseAuthTrustHostRaw() === null) {
    missing.push("AUTH_TRUST_HOST");
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`
    );
  }
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Object storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY."
    );
    this.name = "StorageNotConfiguredError";
  }
}
