import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { listProjects } from "@/actions/project";
import { ProjectsClient } from "@/components/projects/projects-client";
import { redirect } from "next/navigation";

export default async function ProjectsPage({
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

  const projects = await listProjects(tenant.organizationId);

  return (
    <ProjectsClient
      organizationId={tenant.organizationId}
      orgSlug={orgSlug}
      orgName={tenant.organization.name}
      role={tenant.role}
      canCreate={can(tenant.role, "create_project", "project")}
      canDelete={can(tenant.role, "delete_project", "project")}
      projects={projects.ok ? projects.data : []}
    />
  );
}
