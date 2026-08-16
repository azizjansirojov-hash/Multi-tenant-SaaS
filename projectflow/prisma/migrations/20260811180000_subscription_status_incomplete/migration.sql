-- New orgs default to FREE + INCOMPLETE ("no paid subscription").
-- Existing FREE orgs that never had a Stripe customer and were still TRIALING
-- are moved to INCOMPLETE. Stripe trials continue to map to TRIALING + PRO via webhook.

ALTER TABLE "Organization" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'INCOMPLETE';

UPDATE "Organization"
SET "subscriptionStatus" = 'INCOMPLETE'
WHERE "plan" = 'FREE'
  AND "stripeCustomerId" IS NULL
  AND "subscriptionStatus" = 'TRIALING';
