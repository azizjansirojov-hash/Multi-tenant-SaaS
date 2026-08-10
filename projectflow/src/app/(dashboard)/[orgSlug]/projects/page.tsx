import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { listProjects } from "@/actions/project";
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
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{tenant.organization.name}</h1>
      <p className="text-sm text-muted-foreground">Projects · role {tenant.role}</p>
      <ul className="mt-6 space-y-2">
        {projects.ok && projects.data.length === 0 ? (
          <li className="text-muted-foreground">No projects yet.</li>
        ) : null}
        {projects.ok
          ? projects.data.map((p) => (
              <li key={p.id} className="rounded-lg border border-border px-3 py-2">
                {p.name}
              </li>
            ))
          : (
            <li className="text-destructive">{projects.error}</li>
          )}
      </ul>
    </main>
  );
}
