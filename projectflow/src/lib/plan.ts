import type { ActionResult } from "@/lib/validators";
import { Plan, SubscriptionStatus } from "@/types/enums";

export const FREE_MEMBER_LIMIT = 5;
export const FREE_PROJECT_LIMIT = 3;
export const FREE_BOARD_LIMIT = 3;
export const FREE_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const PLAN_LIMIT_ERROR = {
  members: "Upgrade to PRO to add more members",
  projects: "Upgrade to PRO to create more projects",
  boards: "Upgrade to PRO to create more boards",
  storage: "Upgrade to PRO for more attachment storage",
  generic: "Upgrade to PRO to use this feature",
} as const;

export type OrgPlanFields = {
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
};

export function isProOrg(org: OrgPlanFields): boolean {
  return (
    org.plan === Plan.PRO &&
    (org.subscriptionStatus === SubscriptionStatus.ACTIVE ||
      org.subscriptionStatus === SubscriptionStatus.TRIALING)
  );
}

export function requirePro(org: OrgPlanFields): ActionResult<never> | null {
  if (isProOrg(org)) return null;
  return { ok: false, error: PLAN_LIMIT_ERROR.generic };
}

export function isPlanLimitError(error: string): boolean {
  return (Object.values(PLAN_LIMIT_ERROR) as string[]).includes(error);
}

export function assertWithinMemberLimit(
  org: OrgPlanFields,
  currentCount: number
): ActionResult<never> | null {
  if (isProOrg(org)) return null;
  if (currentCount >= FREE_MEMBER_LIMIT) {
    return { ok: false, error: PLAN_LIMIT_ERROR.members };
  }
  return null;
}

export function assertWithinProjectLimit(
  org: OrgPlanFields,
  currentCount: number
): ActionResult<never> | null {
  if (isProOrg(org)) return null;
  if (currentCount >= FREE_PROJECT_LIMIT) {
    return { ok: false, error: PLAN_LIMIT_ERROR.projects };
  }
  return null;
}

export function assertWithinBoardLimit(
  org: OrgPlanFields,
  currentCount: number
): ActionResult<never> | null {
  if (isProOrg(org)) return null;
  if (currentCount >= FREE_BOARD_LIMIT) {
    return { ok: false, error: PLAN_LIMIT_ERROR.boards };
  }
  return null;
}

export function assertWithinAttachmentStorageLimit(
  org: OrgPlanFields,
  currentConfirmedBytes: number,
  incomingBytes: number
): ActionResult<never> | null {
  if (isProOrg(org)) return null;
  if (currentConfirmedBytes + incomingBytes > FREE_ATTACHMENT_BYTES) {
    return { ok: false, error: PLAN_LIMIT_ERROR.storage };
  }
  return null;
}
