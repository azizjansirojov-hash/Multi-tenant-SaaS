import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { Plan, SubscriptionStatus } from "@/generated/prisma/client";

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

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const existing = await db.processedStripeEvent.findUnique({
    where: { id: eventId },
  });
  return Boolean(existing);
}

async function markProcessed(eventId: string, type: string) {
  await db.processedStripeEvent.create({
    data: { id: eventId, type },
  });
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

  if (await alreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const organizationId =
          session.metadata?.organizationId ??
          (typeof session.client_reference_id === "string"
            ? session.client_reference_id
            : null);
        if (organizationId) {
          await db.organization.update({
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
        const org = await db.organization.findFirst({
          where: { stripeCustomerId: customerId },
        });
        if (org) {
          await db.organization.update({
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
        const org = await db.organization.findFirst({
          where: { stripeCustomerId: customerId },
        });
        if (org) {
          await db.organization.update({
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

    await markProcessed(event.id, event.type);
  } catch (error) {
    console.error("Stripe webhook handler error", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
