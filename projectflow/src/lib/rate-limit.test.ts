import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name === "x-forwarded-for" ? "203.0.113.10" : null,
  })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    rateLimitBucket: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  RATE_LIMITS,
  checkRateLimit,
  enforceLoginRateLimit,
  rateLimitErrorMessage,
} from "@/lib/rate-limit";

describe("rate-limit", () => {
  const windowMs = RATE_LIMITS.login.windowMs;
  const fixedNow = new Date("2026-08-10T12:00:00.000Z");
  const windowStart = new Date(
    Math.floor(fixedNow.getTime() / windowMs) * windowMs
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the first 5 attempts then blocks the 6th", async () => {
    let count = 0;
    vi.mocked(db.rateLimitBucket.findUnique).mockImplementation((() => {
      if (count === 0) return Promise.resolve(null);
      return Promise.resolve({
        id: "bucket-1",
        key: "login:email:a@example.com",
        windowStart,
        count,
        updatedAt: fixedNow,
      });
    }) as never);
    vi.mocked(db.rateLimitBucket.create).mockImplementation((() => {
      count = 1;
      return Promise.resolve({
        id: "bucket-1",
        key: "login:email:a@example.com",
        windowStart,
        count: 1,
        updatedAt: fixedNow,
      });
    }) as never);
    vi.mocked(db.rateLimitBucket.update).mockImplementation((() => {
      count += 1;
      return Promise.resolve({
        id: "bucket-1",
        key: "login:email:a@example.com",
        windowStart,
        count,
        updatedAt: fixedNow,
      });
    }) as never);

    const key = "login:email:a@example.com";
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit({
        key,
        limit: 5,
        windowMs,
        now: fixedNow,
      });
      expect(result.allowed).toBe(true);
    }

    const blocked = await checkRateLimit({
      key,
      limit: 5,
      windowMs,
      now: fixedNow,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("scopes buckets so user A exhaustion does not block user B", async () => {
    const counts = new Map<string, number>();

    vi.mocked(db.rateLimitBucket.findUnique).mockImplementation(((args: {
      where: { key_windowStart: { key: string } };
    }) => {
      const key = args.where.key_windowStart.key;
      const count = counts.get(key) ?? 0;
      if (count === 0) return Promise.resolve(null);
      return Promise.resolve({
        id: `id-${key}`,
        key,
        windowStart,
        count,
        updatedAt: fixedNow,
      });
    }) as never);
    vi.mocked(db.rateLimitBucket.create).mockImplementation(((args: {
      data: { key: string };
    }) => {
      const key = args.data.key;
      counts.set(key, 1);
      return Promise.resolve({
        id: `id-${key}`,
        key,
        windowStart,
        count: 1,
        updatedAt: fixedNow,
      });
    }) as never);
    vi.mocked(db.rateLimitBucket.update).mockImplementation(((args: {
      where: { id: string };
    }) => {
      const id = args.where.id;
      const key = id.replace(/^id-/, "");
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve({
        id,
        key,
        windowStart,
        count: next,
        updatedAt: fixedNow,
      });
    }) as never);

    for (let i = 0; i < 5; i++) {
      expect(
        (
          await checkRateLimit({
            key: "login:email:a@example.com",
            limit: 5,
            windowMs,
            now: fixedNow,
          })
        ).allowed
      ).toBe(true);
    }
    expect(
      (
        await checkRateLimit({
          key: "login:email:a@example.com",
          limit: 5,
          windowMs,
          now: fixedNow,
        })
      ).allowed
    ).toBe(false);

    expect(
      (
        await checkRateLimit({
          key: "login:email:b@example.com",
          limit: 5,
          windowMs,
          now: fixedNow,
        })
      ).allowed
    ).toBe(true);
  });

  it("rateLimitErrorMessage is non-revealing", () => {
    expect(rateLimitErrorMessage(90)).toBe(
      "Too many attempts, please try again in 2 minutes"
    );
  });

  it("enforceLoginRateLimit blocks after email bucket is exhausted", async () => {
    vi.mocked(db.rateLimitBucket.findUnique).mockResolvedValue({
      id: "bucket-1",
      key: "login:email:a@example.com",
      windowStart,
      count: 5,
      updatedAt: fixedNow,
    } as never);

    const result = await enforceLoginRateLimit("a@example.com");
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.error).toMatch(/Too many attempts/);
  });
});
