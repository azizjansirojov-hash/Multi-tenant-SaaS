import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runWithRlsBypass } from "@/lib/rls";
import { InviteAcceptClient } from "@/components/invite/invite-accept-client";
import { copy } from "@/lib/copy";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();
  const authenticated = Boolean(session?.user?.id);

  const invitation = await runWithRlsBypass(() =>
    db.invitation.findUnique({
      where: { token },
      include: { organization: { select: { name: true } } },
    })
  );

  if (!invitation) {
    return (
      <InviteAcceptClient
        token={token}
        authenticated={authenticated}
        preview={null}
        previewError={copy.invite.notFound}
      />
    );
  }

  return (
    <InviteAcceptClient
      token={token}
      authenticated={authenticated}
      preview={{
        orgName: invitation.organization.name,
        email: invitation.email,
        role: invitation.role,
        expired: invitation.expiresAt.getTime() <= Date.now(),
        used: Boolean(invitation.acceptedAt),
      }}
      previewError={null}
    />
  );
}
