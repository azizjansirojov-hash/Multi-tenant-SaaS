import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { Plan } from "@/generated/prisma/client";

const STRIPE_SECRET = "whsec_test_secret_for_unit_tests";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  constructEvent: vi.fn(),
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
      findUnique: mocks.findUnique,
      create: mocks.create,
    },
    organization: {
      update: mocks.update,
      findFirst: mocks.findFirst,
    },
  },
}));

describe("Stripe webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
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
  });

  it("updates organization on valid checkout.session.completed", async () => {
    mocks.findUnique.mockResolvedValue(null);
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

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_test_1" },
        data: expect.objectContaining({ plan: Plan.PRO }),
      })
    );
  });
});
