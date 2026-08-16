import { auth } from "@/lib/auth";
import { getTenantId } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { getBoardForOrg } from "@/actions/board";
import { listMembers } from "@/actions/organization";
import { BoardClient } from "@/components/board/board-client";
import { redirect } from "next/navigation";
import { copy } from "@/lib/copy";

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
    return <main className="p-8">{copy.errors.accessDenied}</main>;
  }

  const [board, members] = await Promise.all([
    getBoardForOrg(tenant.organizationId, boardId),
    listMembers(tenant.organizationId),
  ]);

  if (!board.ok) {
    return (
      <main className="p-8">
        <p className="text-destructive">{board.error}</p>
      </main>
    );
  }

  return (
    <BoardClient
      organizationId={tenant.organizationId}
      orgSlug={orgSlug}
      role={tenant.role}
      board={board.data}
      members={members.ok ? members.data : []}
      currentUserId={session.user.id}
    />
  );
}
