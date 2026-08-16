"use client";

import { useEffect, useState, useTransition } from "react";
import { Search, X, CalendarRange } from "lucide-react";
import { searchCards } from "@/actions/search";
import { Priority } from "@/types/enums";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { copy, priorityLabel } from "@/lib/copy";

export type BoardFilterState = {
  query: string;
  assigneeId: string;
  priority: string;
  label: string;
  dueFrom: string;
  dueTo: string;
  matchingIds: string[] | null;
};

export function BoardFilters({
  organizationId,
  boardId,
  members,
  onFilterChange,
}: {
  organizationId: string;
  boardId: string;
  members: Array<{ user: { id: string; name: string | null; email: string } }>;
  onFilterChange: (state: BoardFilterState) => void;
}) {
  const [query, setQuery] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("");
  const [label, setLabel] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasFilters =
    !!query || !!assigneeId || !!priority || !!label || !!dueFrom || !!dueTo;

  useEffect(() => {
    if (!hasFilters) {
      onFilterChange({
        query: "",
        assigneeId: "",
        priority: "",
        label: "",
        dueFrom: "",
        dueTo: "",
        matchingIds: null,
      });
      return;
    }

    const handle = setTimeout(() => {
      startTransition(async () => {
        setError(null);
        const res = await searchCards({
          organizationId,
          boardId,
          query: query || undefined,
          assigneeId: assigneeId || undefined,
          priority: priority || undefined,
          labels: label ? [label] : undefined,
          dueFrom: dueFrom || undefined,
          dueTo: dueTo || undefined,
        });
        if (!res.ok) {
          setError(res.error);
          onFilterChange({
            query,
            assigneeId,
            priority,
            label,
            dueFrom,
            dueTo,
            matchingIds: [],
          });
          return;
        }
        onFilterChange({
          query,
          assigneeId,
          priority,
          label,
          dueFrom,
          dueTo,
          matchingIds: res.data.map((c) => c.id),
        });
      });
    }, 250);

    return () => clearTimeout(handle);
  }, [
    query,
    assigneeId,
    priority,
    label,
    dueFrom,
    dueTo,
    hasFilters,
    organizationId,
    boardId,
    onFilterChange,
  ]);

  function clearAll() {
    setQuery("");
    setAssigneeId("");
    setPriority("");
    setLabel("");
    setDueFrom("");
    setDueTo("");
  }

  const assigneeLabel = assigneeId
    ? members.find((m) => m.user.id === assigneeId)?.user.name ||
      members.find((m) => m.user.id === assigneeId)?.user.email ||
      copy.filters.assignee
    : null;

  const chips: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (query) {
    chips.push({
      key: "query",
      label: `${copy.filters.searchAria}: ${query}`,
      onClear: () => setQuery(""),
    });
  }
  if (assigneeId && assigneeLabel) {
    chips.push({
      key: "assignee",
      label: `${copy.filters.assignee}: ${assigneeLabel}`,
      onClear: () => setAssigneeId(""),
    });
  }
  if (priority) {
    chips.push({
      key: "priority",
      label: `${copy.board.priority}: ${priorityLabel(priority)}`,
      onClear: () => setPriority(""),
    });
  }
  if (label) {
    chips.push({
      key: "label",
      label: `${copy.filters.label}: ${label}`,
      onClear: () => setLabel(""),
    });
  }
  if (dueFrom || dueTo) {
    chips.push({
      key: "due",
      label: `${copy.filters.due} ${dueFrom || "…"} → ${dueTo || "…"}`,
      onClear: () => {
        setDueFrom("");
        setDueTo("");
      },
    });
  }

  return (
    <section aria-label={copy.filters.region} className="space-y-2">
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Badge
              key={chip.key}
              variant="outline"
              className="gap-1 border-primary/30 bg-primary/10 text-primary"
            >
              {chip.label}
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${copy.filters.removeChip} ${chip.label}`}
                onClick={chip.onClear}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            {copy.filters.clearAll}
          </Button>
        </div>
      ) : null}

      <div className="surface-elevated flex flex-col gap-2 p-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-56 sm:shrink-0 md:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="board-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.filters.search}
            className="h-8 pl-8 text-sm"
            aria-label={copy.filters.searchAria}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={assigneeId || "__any__"}
            onValueChange={(v) => setAssigneeId(!v || v === "__any__" ? "" : v)}
          >
            <SelectTrigger
              className={cn(
                "h-8 min-w-[8.5rem]",
                assigneeId && "border-primary/40 bg-primary/5"
              )}
              aria-label={copy.filters.assignee}
            >
              <SelectValue placeholder={copy.filters.anyone} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">{copy.filters.anyone}</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user.id} value={m.user.id}>
                  {m.user.name || m.user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={priority || "__any__"}
            onValueChange={(v) => setPriority(!v || v === "__any__" ? "" : v)}
          >
            <SelectTrigger
              className={cn(
                "h-8 min-w-[7.5rem]",
                priority && "border-primary/40 bg-primary/5"
              )}
              aria-label={copy.board.priority}
            >
              <SelectValue placeholder={copy.filters.anyPriority} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">{copy.filters.anyPriority}</SelectItem>
              {Object.values(Priority).map((p) => (
                <SelectItem key={p} value={p}>
                  {priorityLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            id="filter-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={copy.filters.label}
            aria-label={copy.filters.label}
            className={cn(
              "h-8 w-28 text-sm",
              label && "border-primary/40 bg-primary/5"
            )}
          />

          <Popover>
            <PopoverTrigger
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                (dueFrom || dueTo) && "border-primary/40 bg-primary/5"
              )}
              aria-label={copy.filters.dueRange}
            >
              <CalendarRange className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">{copy.filters.due}</span>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="filter-due-from">{copy.filters.dueFrom}</Label>
                  <Input
                    id="filter-due-from"
                    type="date"
                    value={dueFrom}
                    onChange={(e) => setDueFrom(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="filter-due-to">{copy.filters.dueTo}</Label>
                  <Input
                    id="filter-due-to"
                    type="date"
                    value={dueTo}
                    onChange={(e) => setDueTo(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {pending ? (
            <span className="text-xs text-muted-foreground" role="status">
              {copy.filters.filtering}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
