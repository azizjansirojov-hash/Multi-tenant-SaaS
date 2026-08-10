"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@/types/enums";
import {
  inviteMember,
  removeMembership,
  updateMembershipRole,
  updateOrganization,
  type MemberListItem,
} from "@/actions/organization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ROLES = [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER] as const;

type Props = {
  organizationId: string;
  orgName: string;
  orgSlug: string;
  currentUserId: string;
  currentRole: Role;
  members: MemberListItem[];
  canManage: boolean;
};

export function MembersSettingsClient({
  organizationId,
  orgName,
  orgSlug,
  currentUserId,
  currentRole,
  members: initialMembers,
  canManage,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(orgName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>(Role.MEMBER);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailWarning, setInviteEmailWarning] = useState(false);
  const [copied, setCopied] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);

  async function onRename(e: FormEvent) {
    e.preventDefault();
    setRenamePending(true);
    setRenameError(null);
    const result = await updateOrganization({ organizationId, name });
    setRenamePending(false);
    if (!result.ok) {
      setRenameError(result.error);
      return;
    }
    router.refresh();
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInvitePending(true);
    setInviteError(null);
    setInviteLink(null);
    setInviteEmailWarning(false);
    setCopied(false);
    const result = await inviteMember({
      organizationId,
      email: inviteEmail,
      role: inviteRole,
    });
    setInvitePending(false);
    if (!result.ok) {
      setInviteError(result.error);
      return;
    }
    setInviteLink(result.data.inviteUrl);
    setInviteEmailWarning(!result.data.emailSent);
    setInviteEmail("");
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
  }

  async function onRoleChange(membershipId: string, role: Role) {
    setActionError(null);
    const result = await updateMembershipRole({
      organizationId,
      membershipId,
      role,
    });
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  async function onRemove(membershipId: string) {
    if (!confirm("Remove this member from the organization?")) return;
    setActionError(null);
    const result = await removeMembership({ organizationId, membershipId });
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Members & settings</h1>
        <p className="text-sm text-muted-foreground">
          Organization <span className="font-medium text-foreground">{orgSlug}</span>
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Organization name</CardTitle>
            <CardDescription>
              Renaming does not change the URL slug ({orgSlug}). Slug is
              immutable after creation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onRename} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={renamePending}>
                {renamePending ? "Saving…" : "Save"}
              </Button>
            </form>
            {renameError ? (
              <p className="mt-2 text-sm text-destructive">{renameError}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite member</CardTitle>
            <CardDescription>
              We email an invite link when email delivery is configured. You can
              always copy the link to share manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={onInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                >
                  {ROLES.filter((r) =>
                    currentRole === Role.OWNER ? true : r !== Role.OWNER
                  ).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={invitePending}>
                {invitePending ? "Creating…" : "Create invite"}
              </Button>
            </form>
            {inviteError ? (
              <p className="text-sm text-destructive">{inviteError}</p>
            ) : null}
            {inviteLink ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                {inviteEmailWarning ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Invitation created, but the email failed to send — you can
                    share this link directly:
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Invite email sent. Link (7-day expiry) — share manually if
                    needed:
                  </p>
                )}
                <code className="break-all text-xs">{inviteLink}</code>
                <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {initialMembers.length} member{initialMembers.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actionError ? (
            <p className="mb-3 text-sm text-destructive">{actionError}</p>
          ) : null}
          <ul className="divide-y divide-border">
            {initialMembers.map((m) => {
              const isSelf = m.user.id === currentUserId;
              const canEditThis =
                canManage &&
                !isSelf &&
                !(m.role === Role.OWNER && currentRole !== Role.OWNER);
              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {m.user.name || m.user.email}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">{m.user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Joined {new Date(m.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEditThis ? (
                      <>
                        <select
                          className="flex h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                          value={m.role}
                          onChange={(e) =>
                            onRoleChange(m.id, e.target.value as Role)
                          }
                        >
                          {ROLES.filter((r) =>
                            currentRole === Role.OWNER ? true : r !== Role.OWNER
                          ).map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => onRemove(m.id)}
                        >
                          Remove
                        </Button>
                      </>
                    ) : (
                      <Badge variant="secondary">{m.role}</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
