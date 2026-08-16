"use client";

import { useState } from "react";
import {
  createBillingPortalSession,
  createCheckoutSession,
} from "@/actions/billing";
import { FREE_MEMBER_LIMIT } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";

type Props = {
  organizationId: string;
  plan: string;
  subscriptionStatus: string;
  canManage: boolean;
  success: boolean;
  canceled: boolean;
};

export function BillingSettingsClient({
  organizationId,
  plan,
  subscriptionStatus,
  canManage,
  success,
  canceled,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"checkout" | "portal" | null>(null);

  const isPro = plan === "PRO" && (subscriptionStatus === "ACTIVE" || subscriptionStatus === "TRIALING");

  async function onUpgrade() {
    setPending("checkout");
    setError(null);
    const result = await createCheckoutSession({ organizationId });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.assign(result.data.url);
  }

  async function onManage() {
    setPending("portal");
    setError(null);
    const result = await createBillingPortalSession({ organizationId });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">{copy.billing.title}</h1>
        <p className="text-body text-muted-foreground">
          {copy.billing.subtitle}
        </p>
      </div>

      {success ? (
        <p className="rounded-lg border border-border bg-primary/10 px-3 py-2 text-sm">
          {copy.billing.success}
        </p>
      ) : null}
      {canceled ? (
        <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
          {copy.billing.canceled}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {copy.billing.currentPlan}
            <Badge variant={isPro ? "default" : "secondary"}>{plan}</Badge>
          </CardTitle>
          <CardDescription>
            {copy.billing.status}: {subscriptionStatus}
            {!isPro
              ? ` · ${copy.billing.freeCap} ${FREE_MEMBER_LIMIT} ${copy.billing.membersWord}`
              : ` · ${copy.billing.unlimited}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          {canManage ? (
            <>
              {!isPro ? (
                <Button
                  type="button"
                  onClick={onUpgrade}
                  disabled={pending !== null}
                >
                  {pending === "checkout" ? copy.billing.redirecting : copy.billing.upgrade}
                </Button>
              ) : null}
              <Button
                type="button"
                variant={isPro ? "default" : "outline"}
                onClick={onManage}
                disabled={pending !== null}
              >
                {pending === "portal" ? copy.billing.redirecting : copy.billing.manage}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {copy.billing.ownerOnly}
            </p>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
