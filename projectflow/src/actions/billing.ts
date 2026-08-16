"use server";

import { peekOrgId } from "@/lib/action-errors";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { stripe } from "@/lib/stripe";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createCheckoutSchema,
  zodErrorResult,
} from "@/lib/validators";

export async function createCheckoutSession(
  input: unknown
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_billing", "billing")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = createCheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_PRO) {
    return { ok: false, error: "Stripe is not configured" };
  }

  if (!stripe) {
    return { ok: false, error: "Stripe is not configured" };
  }

  let customerId = tenant.organization.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      metadata: { organizationId: tenant.organizationId },
    });
    customerId = customer.id;
    await db.organization.update({
      where: { id: tenant.organizationId },
      data: { stripeCustomerId: customerId },
    });
  }

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_PRO, quantity: 1 }],
    success_url: `${baseUrl}/${tenant.organization.slug}/settings/billing?success=1`,
    cancel_url: `${baseUrl}/${tenant.organization.slug}/settings/billing?canceled=1`,
    metadata: { organizationId: tenant.organizationId },
  });

  if (!checkout.url) {
    return { ok: false, error: "Failed to create checkout session" };
  }

  return { ok: true, data: { url: checkout.url } };
}

export async function createBillingPortalSession(
  input: unknown
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_billing", "billing")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = createCheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  if (!process.env.STRIPE_SECRET_KEY || !stripe) {
    return { ok: false, error: "Stripe is not configured" };
  }

  const customerId = tenant.organization.stripeCustomerId;
  if (!customerId) {
    return { ok: false, error: "No billing account yet. Upgrade first." };
  }

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/${tenant.organization.slug}/settings/billing`,
  });

  if (!portal.url) {
    return { ok: false, error: "Failed to create billing portal session" };
  }

  return { ok: true, data: { url: portal.url } };
}
