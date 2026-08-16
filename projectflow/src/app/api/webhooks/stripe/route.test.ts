import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { Plan, SubscriptionStatus } from "@/generated/prisma/client";

const STRIPE_SECRET = "whsec_test_secret_for_unit_tests";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  constructEvent: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: {
      constructEvent: mocks.constructEvent,
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    processedStripeEvent: {
      create: mocks.create,
    },
    organization: {
      update: mocks.update,
      findFirst: mocks.findFirst,
    },
    $transaction: mocks.transaction,
  },
}));

async function postWebhook() {
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const payload = "{}";
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = createHmac("sha256", STRIPE_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": `t=${timestamp},v1=${signed}` },
  });
  return POST(req);
}

describe("Stripe webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        processedStripeEvent: { create: mocks.create },
        organization: {
          update: mocks.update,
          findFirst: mocks.findFirst,
        },
      };
      return fn(tx);
    });
  });

  it("rejects invalid signature with 400", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "t=1,v1=invalid" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("updates organization on valid checkout.session.completed", async () => {
    mocks.create.mockResolvedValue({});
    mocks.update.mockResolvedValue({});
    mocks.constructEvent.mockReturnValue({
      id: "evt_test_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test",
          customer: "cus_test",
          metadata: { organizationId: "org_test_1" },
        },
      },
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { id: "evt_test_checkout", type: "checkout.session.completed" },
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_test_1" },
        data: expect.objectContaining({
          plan: Plan.PRO,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        }),
      })
    );
  });

  it("maps customer.subscription.updated past_due to FREE + PAST_DUE", async () => {
    mocks.create.mockResolvedValue({});
    mocks.findFirst.mockResolvedValue({ id: "org_test_1" });
    mocks.update.mockResolvedValue({});
    mocks.constructEvent.mockReturnValue({
      id: "evt_past_due",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_test",
          customer: "cus_test",
          status: "past_due",
        },
      },
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_test" },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "org_test_1" },
      data: {
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        plan: Plan.FREE,
      },
    });
  });

  it("maps customer.subscription.deleted to FREE + CANCELED", async () => {
    mocks.create.mockResolvedValue({});
    mocks.findFirst.mockResolvedValue({ id: "org_test_1" });
    mocks.update.mockResolvedValue({});
    mocks.constructEvent.mockReturnValue({
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_test",
          customer: "cus_test",
          status: "canceled",
        },
      },
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "org_test_1" },
      data: {
        plan: Plan.FREE,
        subscriptionStatus: SubscriptionStatus.CANCELED,
      },
    });
  });

  it("second delivery is idempotent (unique event id) and does not update again", async () => {
    mocks.create.mockRejectedValue({ code: "P2002" });
    mocks.constructEvent.mockReturnValue({
      id: "evt_test_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test",
          customer: "cus_test",
          metadata: { organizationId: "org_test_1" },
        },
      },
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
