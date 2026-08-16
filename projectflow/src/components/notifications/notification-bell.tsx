"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/actions/notification";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Bell, BellOff } from "lucide-react";
import { useRealtime } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

type Notif = {
  id: string;
  type: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
};

export function NotificationBell({
  organizationId,
}: {
  organizationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listMyNotifications({ organizationId, limit: 20 });
    if (!res.ok) {
      setError(res.error);
      setItems([]);
      setUnreadCount(0);
    } else {
      setItems(res.data.items);
      setUnreadCount(res.data.unreadCount);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime({
    organizationId,
    onEvent: (type) => {
      if (type === "notification.created") void load();
    },
  });

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={
          unreadCount > 0
            ? `${copy.notifications.aria}, ${unreadCount} ${copy.notifications.unread}`
            : copy.notifications.aria
        }
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
      >
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={copy.notifications.aria}
          className="surface-elevated absolute right-0 z-50 mt-2 w-80 bg-popover p-2 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-h3">{copy.notifications.title}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || unreadCount === 0}
              onClick={() =>
                startTransition(async () => {
                  const res = await markAllNotificationsRead({
                    organizationId,
                  });
                  if (!res.ok) setError(res.error);
                  else await load();
                })
              }
            >
              {copy.notifications.markAll}
            </Button>
          </div>
          {loading ? (
            <p className="px-2 py-4 text-sm text-muted-foreground" role="status">
              {copy.notifications.loading}
            </p>
          ) : null}
          {error ? (
            <p className="px-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && items.length === 0 ? (
            <EmptyState
              compact
              icon={BellOff}
              title={copy.notifications.empty}
              description={copy.notifications.emptyHint}
            />
          ) : null}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {items.map((n) => {
              const payload = n.payload as { title?: string } | null;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={cn(
                      "w-full rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      n.readAt ? "opacity-70" : "bg-primary/5"
                    )}
                    onClick={() =>
                      startTransition(async () => {
                        if (!n.readAt) {
                          await markNotificationRead({
                            organizationId,
                            notificationId: n.id,
                          });
                          await load();
                        }
                      })
                    }
                  >
                    <span className="font-medium">
                      {n.type.replace(/_/g, " ")}
                    </span>
                    {payload?.title ? (
                      <span className="mt-0.5 block text-muted-foreground">
                        {payload.title}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
