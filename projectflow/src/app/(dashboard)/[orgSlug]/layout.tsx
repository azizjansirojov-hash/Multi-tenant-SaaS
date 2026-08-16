import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTenantId } from "@/lib/tenant";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { redirect } from "next/navigation";

export default async function OrgDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  const memberships = await db.membership.findMany({
    where: { userId: tenant.userId },
    include: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
    orderBy: { organization: { name: "asc" } },
  });

  const organizations = memberships.map((m) => m.organization);

  return (
    <DashboardShell
      orgSlug={orgSlug}
      orgName={tenant.organization.name}
      organizationId={tenant.organizationId}
      organizations={organizations}
    >
      {children}
    </DashboardShell>
  );
}
