"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import {
  AppSidebar,
  type OrgOption,
} from "@/components/layout/app-sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

const COLLAPSE_KEY = "syzx-sidebar-collapsed";

type DashboardShellProps = {
  orgSlug: string;
  orgName: string;
  organizationId: string;
  organizations: OrgOption[];
  children: React.ReactNode;
};

export function DashboardShell({
  orgSlug,
  orgName,
  organizationId,
  organizations,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function handleCollapsedChange(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const isBoard = pathname.includes("/board/");

  return (
    <div className="flex min-h-screen bg-background">
      <div
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 transition-[width] duration-200 md:block",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <AppSidebar
          orgSlug={orgSlug}
          orgName={orgName}
          organizations={organizations}
          collapsed={collapsed}
          onCollapsedChange={handleCollapsedChange}
          className="h-screen"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-sm supports-backdrop-filter:bg-background/75">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={copy.nav.openNav}
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <SheetContent side="left" className="w-72 p-0" showCloseButton>
              <SheetHeader className="sr-only">
                <SheetTitle>{copy.nav.navigation}</SheetTitle>
              </SheetHeader>
              <AppSidebar
                orgSlug={orgSlug}
                orgName={orgName}
                organizations={organizations}
                collapsed={false}
                onCollapsedChange={() => undefined}
                onNavigate={() => setMobileOpen(false)}
                className="h-full border-0"
              />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-muted-foreground md:hidden">
              {orgName}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <NotificationBell organizationId={organizationId} />
            <ThemeToggle />
          </div>
        </header>

        <main
          className={cn(
            "flex-1",
            isBoard ? "min-h-0" : "mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
