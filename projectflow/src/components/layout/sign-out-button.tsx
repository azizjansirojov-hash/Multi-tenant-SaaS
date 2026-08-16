"use client";

import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/components/layout/sign-out-action";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

export function SignOutButton({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <form action={signOutAction} className={className}>
      <Button
        type="submit"
        variant="ghost"
        className={cn(
          "w-full justify-start gap-2 text-muted-foreground hover:text-foreground",
          collapsed && "justify-center px-0"
        )}
        aria-label={copy.nav.signOut}
      >
        <LogOut className="size-4 shrink-0" aria-hidden />
        {!collapsed ? <span>{copy.nav.signOut}</span> : null}
      </Button>
    </form>
  );
}
