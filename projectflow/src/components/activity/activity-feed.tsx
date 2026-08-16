"use client";

import { useCallback, useEffect, useState } from "react";
import { listActivityForOrg } from "@/actions/activity";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";

type ActivityItem = {
  id: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
  action: string;
};

export function ActivityFeed({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listActivityForOrg({
      organizationId,
      projectId,
      limit: 30,
    });
    if (!res.ok) {
      setError(res.error);
      setItems([]);
    } else {
      setItems(
        res.data.items.map((i) => ({
          id: i.id,
          summary: i.summary,
          actorName: i.actorName,
          createdAt: i.createdAt,
          action: i.action,
        }))
      );
    }
    setLoading(false);
  }, [organizationId, projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls="activity-panel"
        onClick={() => setOpen((o) => !o)}
      >
        {copy.activity.button}
      </Button>
      {open ? (
        <aside
          id="activity-panel"
          aria-label={copy.activity.feed}
          className="absolute right-0 z-40 mt-2 w-96 rounded-xl border border-border bg-popover p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">{copy.activity.recent}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
              {copy.activity.refresh}
            </Button>
          </div>
          {loading ? (
            <p className="py-6 text-sm text-muted-foreground" role="status">
              {copy.activity.loading}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && items.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{copy.activity.empty}</p>
          ) : null}
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              >
                <p>{item.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.actorName || copy.activity.system} ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
