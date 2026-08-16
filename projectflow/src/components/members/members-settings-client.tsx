"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@/types/enums";
import {
  deleteOrganization,
  inviteMember,
  leaveOrganization,
  removeMembership,
  revokeInvitation,
  updateMembershipRole,
  updateOrganization,
  type MemberListItem,
  type PendingInvitationItem,
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
import { copy, roleLabel } from "@/lib/copy";

const ROLES = [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER] as const;

type Props = {
  organizationId: string;
  orgName: string;
  orgSlug: string;
  currentUserId: string;
  currentRole: Role;
  members: MemberListItem[];
  pendingInvitations: PendingInvitationItem[];
  canManage: boolean;
  canDeleteOrg: boolean;
  otherOrgSlug: string | null;
};

export function MembersSettingsClient({
  organizationId,
  orgName,
  orgSlug,
  currentUserId,
  currentRole,
  members: initialMembers,
  pendingInvitations,
  canManage,
  canDeleteOrg,
  otherOrgSlug,
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
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leavePending, setLeavePending] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

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
    if (!confirm(copy.members.removeConfirm)) return;
    setActionError(null);
    const result = await removeMembership({ organizationId, membershipId });
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  async function onRevoke(invitationId: string) {
    setActionError(null);
    const result = await revokeInvitation({ organizationId, invitationId });
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  async function onLeave() {
    if (!confirm(copy.members.leaveConfirm)) return;
    setLeavePending(true);
    setLeaveError(null);
    const result = await leaveOrganization({ organizationId });
    setLeavePending(false);
    if (!result.ok) {
      setLeaveError(result.error);
      return;
    }
    router.push(otherOrgSlug ? `/${otherOrgSlug}/projects` : "/");
    router.refresh();
  }

  async function onDeleteOrg(e: FormEvent) {
    e.preventDefault();
    setDeletePending(true);
    setDeleteError(null);
    const result = await deleteOrganization({
      organizationId,
      confirmName: deleteName,
    });
    setDeletePending(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    router.push(otherOrgSlug ? `/${otherOrgSlug}/projects` : "/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1">{copy.members.title}</h1>
        <p className="text-body text-muted-foreground">
          {copy.members.organization}{" "}
          <span className="font-medium text-foreground">{orgSlug}</span>
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.members.orgName}</CardTitle>
            <CardDescription>
              {copy.members.renameHint} ({orgSlug}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onRename} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="org-name">{copy.common.name}</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={renamePending}>
                {renamePending ? copy.common.saving : copy.common.save}
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
            <CardTitle>{copy.members.invite}</CardTitle>
            <CardDescription>{copy.members.inviteHint}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={onInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="invite-email">{copy.common.email}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">{copy.members.role}</Label>
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
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={invitePending}>
                {invitePending ? copy.members.creatingInvite : copy.members.createInvite}
              </Button>
            </form>
            {inviteError ? (
              <p className="text-sm text-destructive">{inviteError}</p>
            ) : null}
            {inviteLink ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                {inviteEmailWarning ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {copy.members.inviteEmailFailed}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {copy.members.inviteEmailSent}
                  </p>
                )}
                <code className="break-all text-xs">{inviteLink}</code>
                <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                  {copied ? copy.members.copied : copy.members.copyLink}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{copy.members.members}</CardTitle>
          <CardDescription>
            {copy.members.memberCount} {initialMembers.length}
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
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({copy.members.you})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">{m.user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {copy.members.joined}{" "}
                      {new Date(m.createdAt).toLocaleDateString("ru-RU")}
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
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => onRemove(m.id)}
                        >
                          {copy.members.remove}
                        </Button>
                      </>
                    ) : (
                      <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.members.pending}</CardTitle>
            <CardDescription>{copy.members.pendingHint}</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{copy.members.noPending}</p>
            ) : (
              <ul className="divide-y divide-border">
                {pendingInvitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {roleLabel(inv.role)} · {copy.members.expires}{" "}
                        {new Date(inv.expiresAt).toLocaleDateString("ru-RU")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRevoke(inv.id)}
                    >
                      {copy.members.revoke}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{copy.members.leave}</CardTitle>
          <CardDescription>{copy.members.leaveHint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            variant="outline"
            onClick={onLeave}
            disabled={leavePending}
          >
            {leavePending ? copy.members.leaving : copy.members.leave}
          </Button>
          {leaveError ? (
            <p className="text-sm text-destructive">{leaveError}</p>
          ) : null}
        </CardContent>
      </Card>

      {canDeleteOrg ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.members.deleteOrg}</CardTitle>
            <CardDescription>
              {copy.members.deleteOrgHint}{" "}
              <span className="font-medium">{orgName}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onDeleteOrg} className="flex max-w-md flex-col gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="confirm-org-name">{copy.members.orgName}</Label>
                <Input
                  id="confirm-org-name"
                  value={deleteName}
                  onChange={(e) => setDeleteName(e.target.value)}
                  required
                />
              </div>
              {deleteError ? (
                <p className="text-sm text-destructive">{deleteError}</p>
              ) : null}
              <Button type="submit" variant="destructive" disabled={deletePending}>
                {deletePending ? copy.members.deleting : copy.members.deleteOrg}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
