import { describe, expect, it } from "vitest";
import { Plan, SubscriptionStatus } from "@/generated/prisma/client";
import {
  FREE_ATTACHMENT_BYTES,
  FREE_BOARD_LIMIT,
  FREE_MEMBER_LIMIT,
  FREE_PROJECT_LIMIT,
  PLAN_LIMIT_ERROR,
  assertWithinAttachmentStorageLimit,
  assertWithinBoardLimit,
  assertWithinMemberLimit,
  assertWithinProjectLimit,
  isPlanLimitError,
  isProOrg,
  requirePro,
} from "@/lib/plan";

const freeIncomplete = {
  plan: Plan.FREE,
  subscriptionStatus: SubscriptionStatus.INCOMPLETE,
};

const proActive = {
  plan: Plan.PRO,
  subscriptionStatus: SubscriptionStatus.ACTIVE,
};

const proTrialing = {
  plan: Plan.PRO,
  subscriptionStatus: SubscriptionStatus.TRIALING,
};

const proPastDue = {
  plan: Plan.PRO,
  subscriptionStatus: SubscriptionStatus.PAST_DUE,
};

describe("isProOrg", () => {
  it("is true only for PRO + ACTIVE or TRIALING", () => {
    expect(isProOrg(proActive)).toBe(true);
    expect(isProOrg(proTrialing)).toBe(true);
    expect(isProOrg(freeIncomplete)).toBe(false);
    expect(isProOrg(proPastDue)).toBe(false);
    expect(
      isProOrg({
        plan: Plan.PRO,
        subscriptionStatus: SubscriptionStatus.CANCELED,
      })
    ).toBe(false);
    expect(
      isProOrg({
        plan: Plan.PRO,
        subscriptionStatus: SubscriptionStatus.INCOMPLETE,
      })
    ).toBe(false);
    expect(
      isProOrg({
        plan: Plan.FREE,
        subscriptionStatus: SubscriptionStatus.TRIALING,
      })
    ).toBe(false);
  });
});

describe("requirePro", () => {
  it("returns null for PRO orgs and a user-safe error otherwise", () => {
    expect(requirePro(proActive)).toBeNull();
    expect(requirePro(freeIncomplete)).toEqual({
      ok: false,
      error: "Upgrade to PRO to use this feature",
    });
  });
});

describe("assertWithinMemberLimit", () => {
  it("caps FREE orgs at FREE_MEMBER_LIMIT including existing members", () => {
    expect(FREE_MEMBER_LIMIT).toBe(5);
    expect(assertWithinMemberLimit(freeIncomplete, 4)).toBeNull();
    expect(assertWithinMemberLimit(freeIncomplete, 5)).toEqual({
      ok: false,
      error: "Upgrade to PRO to add more members",
    });
    expect(assertWithinMemberLimit(freeIncomplete, 6)).toEqual({
      ok: false,
      error: "Upgrade to PRO to add more members",
    });
  });

  it("does not cap PRO ACTIVE/TRIALING orgs", () => {
    expect(assertWithinMemberLimit(proActive, 50)).toBeNull();
    expect(assertWithinMemberLimit(proTrialing, 50)).toBeNull();
  });

  it("applies FREE limits to PAST_DUE / CANCELED / INCOMPLETE", () => {
    expect(assertWithinMemberLimit(proPastDue, 5)).toEqual({
      ok: false,
      error: "Upgrade to PRO to add more members",
    });
  });
});

describe("FREE project / board / storage caps", () => {
  it("caps projects and boards at 3 for FREE orgs", () => {
    expect(FREE_PROJECT_LIMIT).toBe(3);
    expect(FREE_BOARD_LIMIT).toBe(3);
    expect(assertWithinProjectLimit(freeIncomplete, 2)).toBeNull();
    expect(assertWithinProjectLimit(freeIncomplete, 3)).toEqual({
      ok: false,
      error: PLAN_LIMIT_ERROR.projects,
    });
    expect(assertWithinBoardLimit(freeIncomplete, 3)).toEqual({
      ok: false,
      error: PLAN_LIMIT_ERROR.boards,
    });
    expect(assertWithinProjectLimit(proActive, 99)).toBeNull();
    expect(assertWithinBoardLimit(proTrialing, 99)).toBeNull();
  });

  it("caps confirmed attachment storage for FREE orgs", () => {
    expect(FREE_ATTACHMENT_BYTES).toBe(100 * 1024 * 1024);
    expect(
      assertWithinAttachmentStorageLimit(freeIncomplete, FREE_ATTACHMENT_BYTES - 10, 10)
    ).toBeNull();
    expect(
      assertWithinAttachmentStorageLimit(freeIncomplete, FREE_ATTACHMENT_BYTES, 1)
    ).toEqual({ ok: false, error: PLAN_LIMIT_ERROR.storage });
    expect(
      assertWithinAttachmentStorageLimit(proActive, FREE_ATTACHMENT_BYTES, 1_000_000)
    ).toBeNull();
  });

  it("isPlanLimitError recognizes upgrade copy", () => {
    expect(isPlanLimitError(PLAN_LIMIT_ERROR.boards)).toBe(true);
    expect(isPlanLimitError("Access denied")).toBe(false);
  });
});
