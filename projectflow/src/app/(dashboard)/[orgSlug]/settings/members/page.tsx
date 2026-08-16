import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { listMembers, listPendingInvitations } from "@/actions/organization";
import { MembersSettingsClient } from "@/components/members/members-settings-client";
import { redirect } from "next/navigation";
import { copy } from "@/lib/copy";

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
    return <div className="p-8">{copy.errors.accessDenied}</div>;
  }

  const members = await listMembers(tenant.organizationId);
  if (!members.ok) {
    return (
      <div className="p-8">
        <p className="text-destructive">{members.error}</p>
      </div>
    );
  }

  const canManage = can(tenant.role, "manage_members", "members");
  const pending = canManage
    ? await listPendingInvitations({ organizationId: tenant.organizationId })
    : { ok: true as const, data: [] };

  const otherMembership = await db.membership.findFirst({
    where: {
      userId: tenant.userId,
      organizationId: { not: tenant.organizationId },
    },
    select: { organization: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <MembersSettingsClient
      organizationId={tenant.organizationId}
      orgName={tenant.organization.name}
      orgSlug={tenant.organization.slug}
      currentUserId={tenant.userId}
      currentRole={tenant.role}
      members={members.data}
      pendingInvitations={pending.ok ? pending.data : []}
      canManage={canManage}
      canDeleteOrg={can(tenant.role, "delete_organization")}
      otherOrgSlug={otherMembership?.organization.slug ?? null}
    />
  );
}
