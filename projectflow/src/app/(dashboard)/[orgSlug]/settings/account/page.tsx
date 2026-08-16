import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { AccountSettingsClient } from "@/components/account/account-settings-client";
import { redirect } from "next/navigation";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  try {
    await getTenantId(orgSlug);
  } catch {
    redirect("/login");
  }

  return <AccountSettingsClient />;
}
