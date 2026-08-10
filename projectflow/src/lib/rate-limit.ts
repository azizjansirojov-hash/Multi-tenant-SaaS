import { headers } from "next/headers";
import { db } from "@/lib/db";

/** Tunable defaults — adjust as product needs evolve. */
export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  register: { limit: 10, windowMs: 60 * 60 * 1000 },
  invite: { limit: 20, windowMs: 60 * 60 * 1000 },
  changePassword: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function windowStartFor(now: Date, windowMs: number): Date {
  const ms = now.getTime();
  return new Date(Math.floor(ms / windowMs) * windowMs);
}

/**
 * Fixed-window counter backed by Postgres (works across Vercel serverless instances).
 */
export async function checkRateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
}): Promise<RateLimitResult> {
  const now = options.now ?? new Date();
  const windowStart = windowStartFor(now, options.windowMs);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(
      (windowStart.getTime() + options.windowMs - now.getTime()) / 1000
    )
  );

  const existing = await db.rateLimitBucket.findUnique({
    where: {
      key_windowStart: {
        key: options.key,
        windowStart,
      },
    },
  });

  if (existing && existing.count >= options.limit) {
    return { allowed: false, retryAfterSeconds };
  }

  if (existing) {
    const updated = await db.rateLimitBucket.update({
      where: { id: existing.id },
      data: { count: { increment: 1 } },
    });
    if (updated.count > options.limit) {
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true };
  }

  try {
    await db.rateLimitBucket.create({
      data: {
        key: options.key,
        windowStart,
        count: 1,
      },
    });
    return { allowed: true };
  } catch {
    // Race: another request created the row — re-check / increment
    const raced = await db.rateLimitBucket.findUnique({
      where: {
        key_windowStart: {
          key: options.key,
          windowStart,
        },
      },
    });
    if (!raced) {
      return { allowed: true };
    }
    if (raced.count >= options.limit) {
      return { allowed: false, retryAfterSeconds };
    }
    const updated = await db.rateLimitBucket.update({
      where: { id: raced.id },
      data: { count: { increment: 1 } },
    });
    if (updated.count > options.limit) {
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true };
  }
}

export function rateLimitErrorMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts, please try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = h.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  } catch {
    // headers() unavailable outside a request context (e.g. some tests)
  }
  return "unknown";
}

export async function enforceLoginRateLimit(
  email: string
): Promise<{ ok: false; error: string } | null> {
  const ip = await clientIp();
  const normalized = email.trim().toLowerCase();
  const emailCheck = await checkRateLimit({
    key: `login:email:${normalized}`,
    ...RATE_LIMITS.login,
  });
  if (!emailCheck.allowed) {
    return {
      ok: false,
      error: rateLimitErrorMessage(emailCheck.retryAfterSeconds),
    };
  }
  const ipCheck = await checkRateLimit({
    key: `login:ip:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!ipCheck.allowed) {
    return {
      ok: false,
      error: rateLimitErrorMessage(ipCheck.retryAfterSeconds),
    };
  }
  return null;
}

export async function enforceRegisterRateLimit(): Promise<{
  ok: false;
  error: string;
} | null> {
  const ip = await clientIp();
  const check = await checkRateLimit({
    key: `register:ip:${ip}`,
    ...RATE_LIMITS.register,
  });
  if (!check.allowed) {
    return {
      ok: false,
      error: rateLimitErrorMessage(check.retryAfterSeconds),
    };
  }
  return null;
}

export async function enforceInviteRateLimit(
  organizationId: string
): Promise<{ ok: false; error: string } | null> {
  const check = await checkRateLimit({
    key: `invite:org:${organizationId}`,
    ...RATE_LIMITS.invite,
  });
  if (!check.allowed) {
    return {
      ok: false,
      error: rateLimitErrorMessage(check.retryAfterSeconds),
    };
  }
  return null;
}

export async function enforceChangePasswordRateLimit(
  userId: string
): Promise<{ ok: false; error: string } | null> {
  const check = await checkRateLimit({
    key: `password:user:${userId}`,
    ...RATE_LIMITS.changePassword,
  });
  if (!check.allowed) {
    return {
      ok: false,
      error: rateLimitErrorMessage(check.retryAfterSeconds),
    };
  }
  return null;
}
