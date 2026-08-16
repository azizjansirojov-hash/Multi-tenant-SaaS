"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  CreditCard,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Users,
} from "lucide-react";
import { createOrganization } from "@/actions/organization";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { copy } from "@/lib/copy";

export type OrgOption = {
  id: string;
  name: string;
  slug: string;
};

type AppSidebarProps = {
  orgSlug: string;
  orgName: string;
  organizations: OrgOption[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNavigate?: () => void;
  className?: string;
};

export function AppSidebar({
  orgSlug,
  orgName,
  organizations,
  collapsed,
  onCollapsedChange,
  onNavigate,
  className,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [orgNameInput, setOrgNameInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);

  async function onCreateOrg(e: FormEvent) {
    e.preventDefault();
    setCreatePending(true);
    setCreateError(null);
    const result = await createOrganization({ name: orgNameInput });
    setCreatePending(false);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }
    setCreateOpen(false);
    setOrgNameInput("");
    onNavigate?.();
    router.push(`/${result.data.slug}/projects`);
  }

  const nav = [
    {
      href: `/${orgSlug}/projects`,
      label: copy.nav.projects,
      icon: FolderKanban,
      match: (path: string) =>
        path.includes("/projects") || path.includes("/board/"),
    },
    {
      href: `/${orgSlug}/settings/members`,
      label: copy.nav.members,
      icon: Users,
      match: (path: string) => path.includes("/settings/members"),
    },
    {
      href: `/${orgSlug}/settings/billing`,
      label: copy.nav.billing,
      icon: CreditCard,
      match: (path: string) => path.includes("/settings/billing"),
    },
    {
      href: `/${orgSlug}/settings/account`,
      label: copy.nav.account,
      icon: UserRound,
      match: (path: string) => path.includes("/settings/account"),
    },
  ];

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        className
      )}
      aria-label={copy.nav.orgNav}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-sidebar-border p-3",
          collapsed && "flex-col"
        )}
      >
        <Link
          href={`/${orgSlug}/projects`}
          onClick={onNavigate}
          className={cn(
            "font-heading text-lg font-semibold tracking-tight text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            collapsed && "text-center text-sm"
          )}
        >
          {collapsed ? "S" : "SYZX"}
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("ml-auto shrink-0", collapsed && "ml-0")}
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? copy.nav.expandSidebar : copy.nav.collapseSidebar}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>

      <div className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed && "justify-center px-0"
            )}
            aria-label={`Organization: ${orgName}`}
          >
            {!collapsed ? (
              <span className="truncate">{orgName}</span>
            ) : (
              <span className="text-xs font-semibold">
                {orgName.slice(0, 1).toUpperCase()}
              </span>
            )}
            {!collapsed ? (
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                className={cn(
                  org.slug === orgSlug && "bg-primary/10 text-primary"
                )}
                onClick={() => {
                  onNavigate?.();
                  router.push(`/${org.slug}/projects`);
                }}
              >
                {org.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setCreateError(null);
                setOrgNameInput("");
                setCreateOpen(true);
              }}
            >
              {copy.nav.createOrg}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.nav.createOrg}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onCreateOrg} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-org-name">{copy.common.name}</Label>
              <Input
                id="new-org-name"
                value={orgNameInput}
                onChange={(e) => setOrgNameInput(e.target.value)}
                required
              />
            </div>
            {createError ? (
              <p className="text-sm text-destructive">{createError}</p>
            ) : null}
            <Button type="submit" disabled={createPending}>
              {createPending ? copy.common.creating : copy.common.create}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label={copy.nav.orgNav}>
        {nav.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                collapsed && "justify-center px-0"
              )}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 p-2">
        <Separator />
        <SignOutButton collapsed={collapsed} />
      </div>
    </aside>
  );
}
