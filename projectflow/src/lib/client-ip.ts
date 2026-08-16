import { trustedProxyCount } from "@/lib/env";

export type ResolveClientIpInput = {
  xff: string | null;
  realIp: string | null;
  trustedProxyCount: number;
  fallback?: string;
};

/**
 * Walk X-Forwarded-For from the right, skipping `trustedProxyCount` hops.
 * When count is 0, forwarded headers are ignored (not spoofable).
 */
export function resolveClientIp(input: ResolveClientIpInput): string {
  const fallback = input.fallback ?? "unknown";
  const count = Number.isFinite(input.trustedProxyCount)
    ? Math.max(0, Math.floor(input.trustedProxyCount))
    : 0;
  if (count === 0) return fallback;

  const hops = (input.xff ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const index = hops.length - 1 - count;
  if (index >= 0) return hops[index]!;

  const real = input.realIp?.trim();
  if (real) return real;
  return fallback;
}

export async function clientIpFromHeaders(headers: {
  get(name: string): string | null;
}): Promise<string> {
  return resolveClientIp({
    xff: headers.get("x-forwarded-for"),
    realIp: headers.get("x-real-ip"),
    trustedProxyCount: trustedProxyCount(),
  });
}
