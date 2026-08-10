import { describe, expect, it } from "vitest";
import { isSessionVersionValid } from "@/lib/session-version";

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
