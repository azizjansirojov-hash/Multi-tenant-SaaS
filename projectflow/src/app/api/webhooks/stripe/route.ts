import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { Plan, SubscriptionStatus } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";

function mapSubscriptionStatus(
  status: Stripe.Subscription.Status
): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

async function applyStripeEvent(
  tx: Prisma.TransactionClient,
  event: Stripe.Event
) {
  await tx.processedStripeEvent.create({
    data: { id: event.id, type: event.type },
  });

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId =
        session.metadata?.organizationId ??
        (typeof session.client_reference_id === "string"
          ? session.client_reference_id
          : null);
      if (organizationId) {
        await tx.organization.update({
          where: { id: organizationId },
          data: {
            plan: Plan.PRO,
            subscriptionStatus: SubscriptionStatus.ACTIVE,
            stripeCustomerId:
              typeof session.customer === "string"
                ? session.customer
                : undefined,
          },
        });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const org = await tx.organization.findFirst({
        where: { stripeCustomerId: customerId },
      });
      if (org) {
        await tx.organization.update({
          where: { id: org.id },
          data: {
            subscriptionStatus: mapSubscriptionStatus(sub.status),
            plan:
              sub.status === "active" || sub.status === "trialing"
                ? Plan.PRO
                : Plan.FREE,
          },
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const org = await tx.organization.findFirst({
        where: { stripeCustomerId: customerId },
      });
      if (org) {
        await tx.organization.update({
          where: { id: org.id },
          data: {
            plan: Plan.FREE,
            subscriptionStatus: SubscriptionStatus.CANCELED,
          },
        });
      }
      break;
    }
    default:
      break;
  }
}

export async function POST(req: NextRequest) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Stripe webhook not configured" },
      { status: 500 }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    await db.$transaction((tx) => applyStripeEvent(tx, event));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("Stripe webhook handler error", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
