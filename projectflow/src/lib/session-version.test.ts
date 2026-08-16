import { describe, expect, it } from "vitest";
import {
  isEdgeJwtFresh,
  isEdgeJwtStructurallyValid,
  isSessionVersionValid,
  SESSION_VERSION_MAX_STALE_SECONDS,
} from "@/lib/session-version";

describe("isSessionVersionValid (JWT invalidation)", () => {
  it("GAP (pre-fix): JWT stays valid when only Membership is deleted and sessionVersion is unchanged", () => {
    // Historical gap: deleting Membership does not bump sessionVersion, so a
    // JWT minted at version 0 still matches DB version 0 until expiry.
    const tokenVersion = 0;
    const dbVersionAfterMembershipDeleteOnly = 0;
    expect(
      isSessionVersionValid(tokenVersion, dbVersionAfterMembershipDeleteOnly)
    ).toBe(true);
  });

  it("rejects JWT when DB sessionVersion was incremented", () => {
    expect(isSessionVersionValid(0, 1)).toBe(false);
    expect(isSessionVersionValid(3, 4)).toBe(false);
  });

  it("accepts matching versions", () => {
    expect(isSessionVersionValid(0, 0)).toBe(true);
    expect(isSessionVersionValid(2, 2)).toBe(true);
  });

  it("rejects missing token version or missing user", () => {
    expect(isSessionVersionValid(undefined, 0)).toBe(false);
    expect(isSessionVersionValid(0, null)).toBe(false);
    expect(isSessionVersionValid(0, undefined)).toBe(false);
  });
});

describe("isEdgeJwtStructurallyValid (middleware, no DB)", () => {
  it("accepts a signed-in JWT with numeric sessionVersion", () => {
    expect(
      isEdgeJwtStructurallyValid({ sub: "u1", sessionVersion: 0 })
    ).toBe(true);
    expect(
      isEdgeJwtStructurallyValid({ sub: "u1", sessionVersion: 4 })
    ).toBe(true);
  });

  it("rejects missing token, missing sub, or non-numeric sessionVersion", () => {
    expect(isEdgeJwtStructurallyValid(null)).toBe(false);
    expect(isEdgeJwtStructurallyValid({ sessionVersion: 0 })).toBe(false);
    expect(isEdgeJwtStructurallyValid({ sub: "u1" })).toBe(false);
    expect(
      isEdgeJwtStructurallyValid({ sub: "u1", sessionVersion: "0" })
    ).toBe(false);
  });

  it("rejects tokens already stamped SessionInvalidated by the jwt callback", () => {
    expect(
      isEdgeJwtStructurallyValid({
        sub: "u1",
        sessionVersion: 0,
        error: "SessionInvalidated",
      })
    ).toBe(false);
  });
});

describe("isEdgeJwtFresh (middleware staleness window)", () => {
  it("accepts a sessionCheckedAt within SESSION_VERSION_MAX_STALE_SECONDS", () => {
    expect(SESSION_VERSION_MAX_STALE_SECONDS).toBe(60);
    expect(
      isEdgeJwtFresh({ sessionCheckedAt: 1_000 }, 1_000 + 60)
    ).toBe(true);
  });

  it("rejects missing sessionCheckedAt and values older than the window", () => {
    expect(isEdgeJwtFresh({ sessionCheckedAt: 1_000 }, 1_000 + 61)).toBe(
      false
    );
    expect(isEdgeJwtFresh({}, 1_000)).toBe(false);
    expect(isEdgeJwtFresh(null, 1_000)).toBe(false);
  });
});
