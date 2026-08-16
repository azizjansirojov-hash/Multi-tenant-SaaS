import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeMocks = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({
  requireMembership: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    customers: { create: stripeMocks.customersCreate },
    checkout: { sessions: { create: stripeMocks.checkoutCreate } },
    billingPortal: { sessions: { create: stripeMocks.portalCreate } },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    organization: { update: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { requireMembership } from "@/lib/tenant";
import {
  createBillingPortalSession,
  createCheckoutSession,
} from "@/actions/billing";

function mockAuth() {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: "owner-1", email: "owner@example.com", sessionVersion: 0 },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockTenant(
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
  stripeCustomerId: string | null = "cus_existing"
) {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: "org-1",
    userId: "owner-1",
    role,
    organization: {
      id: "org-1",
      slug: "acme",
      name: "Acme",
      stripeCustomerId,
    } as never,
    membership: { id: "m1", role } as never,
  });
}

describe("billing actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    process.env.STRIPE_PRICE_PRO = "price_test";
    process.env.AUTH_URL = "http://localhost:3000";
  });

  it("createCheckoutSession allows OWNER", async () => {
    mockTenant("OWNER", "cus_existing");
    stripeMocks.checkoutCreate.mockResolvedValue({
      url: "https://checkout.stripe.test/cs",
    });

    const res = await createCheckoutSession({ organizationId: "org-1" });
    expect(res).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.test/cs" },
    });
    expect(stripeMocks.checkoutCreate).toHaveBeenCalled();
  });

  it("createCheckoutSession denies ADMIN", async () => {
    mockTenant("ADMIN");
    const res = await createCheckoutSession({ organizationId: "org-1" });
    expect(res).toEqual({ ok: false, error: "Access denied" });
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("createCheckoutSession returns Stripe is not configured when keys are missing", async () => {
    mockTenant("OWNER");
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_PRO;
    const res = await createCheckoutSession({ organizationId: "org-1" });
    expect(res).toEqual({ ok: false, error: "Stripe is not configured" });
  });

  it("createBillingPortalSession allows OWNER with a customer", async () => {
    mockTenant("OWNER", "cus_existing");
    stripeMocks.portalCreate.mockResolvedValue({
      url: "https://billing.stripe.test/session",
    });

    const res = await createBillingPortalSession({ organizationId: "org-1" });
    expect(res).toEqual({
      ok: true,
      data: { url: "https://billing.stripe.test/session" },
    });
    expect(stripeMocks.portalCreate).toHaveBeenCalledWith({
      customer: "cus_existing",
      return_url: "http://localhost:3000/acme/settings/billing",
    });
  });

  it("createBillingPortalSession denies ADMIN", async () => {
    mockTenant("ADMIN", "cus_existing");
    const res = await createBillingPortalSession({ organizationId: "org-1" });
    expect(res).toEqual({ ok: false, error: "Access denied" });
    expect(stripeMocks.portalCreate).not.toHaveBeenCalled();
  });

  it("createBillingPortalSession fails when Stripe is not configured", async () => {
    mockTenant("OWNER", "cus_existing");
    delete process.env.STRIPE_SECRET_KEY;
    const res = await createBillingPortalSession({ organizationId: "org-1" });
    expect(res).toEqual({ ok: false, error: "Stripe is not configured" });
  });

  it("createBillingPortalSession fails when there is no Stripe customer", async () => {
    mockTenant("OWNER", null);
    const res = await createBillingPortalSession({ organizationId: "org-1" });
    expect(res).toEqual({
      ok: false,
      error: "No billing account yet. Upgrade first.",
    });
    expect(stripeMocks.portalCreate).not.toHaveBeenCalled();
  });
});

describe("FREE plan constants used by billing UI", () => {
  it("exposes member / project / board / storage caps", async () => {
    const {
      FREE_MEMBER_LIMIT,
      FREE_PROJECT_LIMIT,
      FREE_BOARD_LIMIT,
      FREE_ATTACHMENT_BYTES,
    } = await import("@/lib/plan");
    expect(FREE_MEMBER_LIMIT).toBe(5);
    expect(FREE_PROJECT_LIMIT).toBe(3);
    expect(FREE_BOARD_LIMIT).toBe(3);
    expect(FREE_ATTACHMENT_BYTES).toBe(100 * 1024 * 1024);
  });
});
