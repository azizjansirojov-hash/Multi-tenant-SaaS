import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { BillingSettingsClient } from "@/components/billing/billing-settings-client";
import { redirect } from "next/navigation";

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  let tenant;
  try {
    tenant = await getTenantId(orgSlug);
  } catch {
    redirect("/login");
  }

  return (
    <BillingSettingsClient
      organizationId={tenant.organizationId}
      plan={tenant.organization.plan}
      subscriptionStatus={tenant.organization.subscriptionStatus}
      canManage={can(tenant.role, "manage_billing", "billing")}
      success={query.success === "1"}
      canceled={query.canceled === "1"}
    />
  );
}
