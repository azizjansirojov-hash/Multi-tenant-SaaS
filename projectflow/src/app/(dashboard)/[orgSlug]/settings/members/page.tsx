import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { listMembers } from "@/actions/organization";
import { MembersSettingsClient } from "@/components/members/members-settings-client";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
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

  if (!can(tenant.role, "view_card", "card")) {
    return <main className="p-8">Access denied</main>;
  }

  const members = await listMembers(tenant.organizationId);
  if (!members.ok) {
    return (
      <main className="p-8">
        <p className="text-destructive">{members.error}</p>
      </main>
    );
  }

  const canManage = can(tenant.role, "manage_members", "members");

  return (
    <>
      <nav className="border-b border-border px-8 py-3 text-sm">
        <Link href={`/${orgSlug}/projects`} className="text-muted-foreground hover:text-foreground">
          ← Projects
        </Link>
      </nav>
      <MembersSettingsClient
        organizationId={tenant.organizationId}
        orgName={tenant.organization.name}
        orgSlug={tenant.organization.slug}
        currentUserId={tenant.userId}
        currentRole={tenant.role}
        members={members.data}
        canManage={canManage}
      />
    </>
  );
}
