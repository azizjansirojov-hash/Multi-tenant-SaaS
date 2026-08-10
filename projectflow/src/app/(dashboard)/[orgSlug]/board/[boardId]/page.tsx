import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { getBoardForOrg } from "@/actions/board";
import { redirect } from "next/navigation";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ orgSlug: string; boardId: string }>;
}) {
  const { orgSlug, boardId } = await params;
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

  const board = await getBoardForOrg(tenant.organizationId, boardId);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">
        {board.ok ? board.data.name : "Board"}
      </h1>
      {!board.ok ? (
        <p className="text-destructive">{board.error}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Board ID {board.data.id}</p>
      )}
    </main>
  );
}
