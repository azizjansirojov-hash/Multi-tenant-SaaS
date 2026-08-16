import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { listBoardsForProject } from "@/actions/board";
import { db } from "@/lib/db";
import { ProjectBoardsClient } from "@/components/projects/project-boards-client";
import { redirect, notFound } from "next/navigation";
import { copy } from "@/lib/copy";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
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
    return <main className="p-8">{copy.errors.accessDenied}</main>;
  }

  const project = await db.project.findFirst({
    where: { id: projectId, organizationId: tenant.organizationId },
    select: { id: true, name: true, description: true },
  });
  if (!project) {
    notFound();
  }

  const boards = await listBoardsForProject({
    organizationId: tenant.organizationId,
    projectId: project.id,
  });

  return (
    <ProjectBoardsClient
      organizationId={tenant.organizationId}
      orgSlug={orgSlug}
      projectId={project.id}
      projectName={project.name}
      projectDescription={project.description}
      canCreate={can(tenant.role, "create_project", "project")}
      boards={boards.ok ? boards.data : []}
    />
  );
}
