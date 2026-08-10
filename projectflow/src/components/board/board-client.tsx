"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Priority, type Role } from "@/types/enums";
import {
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumn,
  updateBoard,
  type BoardDetail,
  type BoardCard,
} from "@/actions/board";
import {
  createCard,
  updateCard,
  deleteCard,
  reorderCard,
} from "@/actions/card";
import type { MemberListItem } from "@/actions/organization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  organizationId: string;
  orgSlug: string;
  role: Role;
  board: BoardDetail;
  members: MemberListItem[];
};

function parseLabels(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function BoardClient({
  organizationId,
  orgSlug,
  role,
  board: initialBoard,
  members,
}: Props) {
  const router = useRouter();
  const canManageBoard = role === "OWNER" || role === "ADMIN";
  const canEditCards =
    role === "OWNER" || role === "ADMIN" || role === "MEMBER";

  const [error, setError] = useState<string | null>(null);
  const [boardName, setBoardName] = useState(initialBoard.name);
  const [columnName, setColumnName] = useState("");
  const [pending, setPending] = useState(false);

  const [cardDialog, setCardDialog] = useState<{
    mode: "create" | "edit";
    columnId: string;
    card?: BoardCard;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [labels, setLabels] = useState("");

  function refresh() {
    router.refresh();
  }

  async function onRenameBoard(e: FormEvent) {
    e.preventDefault();
    if (!canManageBoard) return;
    setPending(true);
    setError(null);
    const result = await updateBoard({
      organizationId,
      boardId: initialBoard.id,
      name: boardName,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function onAddColumn(e: FormEvent) {
    e.preventDefault();
    if (!canManageBoard) return;
    setPending(true);
    setError(null);
    const result = await createColumn({
      organizationId,
      boardId: initialBoard.id,
      name: columnName,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setColumnName("");
    refresh();
  }

  async function onRenameColumn(columnId: string, name: string) {
    if (!canManageBoard) return;
    const result = await updateColumn({ organizationId, columnId, name });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function onDeleteColumn(columnId: string) {
    if (!canManageBoard) return;
    if (!confirm("Delete this column and all its cards?")) return;
    const result = await deleteColumn({ organizationId, columnId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function onReorderColumn(columnId: string, direction: "up" | "down") {
    if (!canManageBoard) return;
    const result = await reorderColumn({
      organizationId,
      columnId,
      direction,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  }

  function openCreateCard(columnId: string) {
    setCardDialog({ mode: "create", columnId });
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setDueDate("");
    setPriority(Priority.MEDIUM);
    setLabels("");
    setError(null);
  }

  function openEditCard(columnId: string, card: BoardCard) {
    setCardDialog({ mode: "edit", columnId, card });
    setTitle(card.title);
    setDescription(card.description ?? "");
    setAssigneeId(card.assigneeId ?? "");
    setDueDate(
      card.dueDate
        ? new Date(card.dueDate).toISOString().slice(0, 10)
        : ""
    );
    setPriority(card.priority);
    setLabels(card.labels.join(", "));
    setError(null);
  }

  async function onSaveCard(e: FormEvent) {
    e.preventDefault();
    if (!cardDialog || !canEditCards) return;
    setPending(true);
    setError(null);

    if (cardDialog.mode === "create") {
      const result = await createCard({
        organizationId,
        columnId: cardDialog.columnId,
        title,
        description: description || undefined,
        assigneeId: assigneeId || undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        priority,
        labels: parseLabels(labels),
      });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
    } else if (cardDialog.card) {
      const result = await updateCard({
        organizationId,
        cardId: cardDialog.card.id,
        title,
        description: description || null,
        assigneeId: assigneeId || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        priority,
        labels: parseLabels(labels),
      });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
    }

    setCardDialog(null);
    refresh();
  }

  async function onDeleteCard(cardId: string) {
    if (!canEditCards) return;
    if (!confirm("Delete this card?")) return;
    const result = await deleteCard({ organizationId, cardId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCardDialog(null);
    refresh();
  }

  async function onReorderCard(cardId: string, direction: "up" | "down") {
    if (!canEditCards) return;
    const result = await reorderCard({ organizationId, cardId, direction });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href={`/${orgSlug}/projects`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← {initialBoard.projectName}
            </Link>
            {canManageBoard ? (
              <form
                onSubmit={onRenameBoard}
                className="mt-1 flex items-center gap-2"
              >
                <Input
                  value={boardName}
                  onChange={(e) => setBoardName(e.target.value)}
                  className="max-w-xs text-lg font-semibold"
                />
                <Button type="submit" size="sm" variant="outline" disabled={pending}>
                  Rename
                </Button>
              </form>
            ) : (
              <h1 className="text-2xl font-semibold">{initialBoard.name}</h1>
            )}
          </div>
          {canManageBoard ? (
            <form onSubmit={onAddColumn} className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="new-col" className="sr-only">
                  Column name
                </Label>
                <Input
                  id="new-col"
                  placeholder="New column"
                  value={columnName}
                  onChange={(e) => setColumnName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={pending}>
                Add column
              </Button>
            </form>
          ) : null}
        </div>
        {error ? (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        ) : null}
      </header>

      <div className="flex flex-1 gap-4 overflow-x-auto p-6">
        {initialBoard.columns.length === 0 ? (
          <p className="text-muted-foreground">
            No columns yet.
            {canManageBoard ? " Add a column to start." : null}
          </p>
        ) : null}
        {initialBoard.columns.map((col, colIdx) => (
          <div
            key={col.id}
            className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/30"
          >
            <div className="flex items-start justify-between gap-2 border-b border-border p-3">
              <div className="min-w-0 flex-1">
                {canManageBoard ? (
                  <Input
                    defaultValue={col.name}
                    className="h-8 font-medium"
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== col.name) {
                        onRenameColumn(col.id, next);
                      }
                    }}
                  />
                ) : (
                  <h2 className="font-medium">{col.name}</h2>
                )}
              </div>
              {canManageBoard ? (
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={colIdx === 0}
                    onClick={() => onReorderColumn(col.id, "up")}
                    aria-label="Move column left"
                  >
                    ←
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={colIdx === initialBoard.columns.length - 1}
                    onClick={() => onReorderColumn(col.id, "down")}
                    aria-label="Move column right"
                  >
                    →
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="destructive"
                    onClick={() => onDeleteColumn(col.id)}
                    aria-label="Delete column"
                  >
                    ×
                  </Button>
                </div>
              ) : null}
            </div>

            <ul className="flex flex-1 flex-col gap-2 p-3">
              {col.cards.map((card, cardIdx) => (
                <li
                  key={card.id}
                  className="rounded-lg border border-border bg-background p-3 shadow-sm"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => openEditCard(col.id, card)}
                  >
                    <p className="font-medium">{card.title}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary">{card.priority}</Badge>
                      {card.assignee ? (
                        <Badge variant="outline">
                          {card.assignee.name || card.assignee.email}
                        </Badge>
                      ) : null}
                      {card.labels.map((l) => (
                        <Badge key={l} variant="outline">
                          {l}
                        </Badge>
                      ))}
                    </div>
                  </button>
                  {canEditCards ? (
                    <div className="mt-2 flex gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={cardIdx === 0}
                        onClick={() => onReorderCard(card.id, "up")}
                      >
                        Up
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={cardIdx === col.cards.length - 1}
                        onClick={() => onReorderCard(card.id, "down")}
                      >
                        Down
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {canEditCards ? (
              <div className="border-t border-border p-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openCreateCard(col.id)}
                >
                  Add card
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <Dialog
        open={!!cardDialog}
        onOpenChange={(o) => !o && setCardDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {cardDialog?.mode === "edit" ? "Edit card" : "New card"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSaveCard} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="card-title">Title</Label>
              <Input
                id="card-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={!canEditCards}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-desc">Description</Label>
              <Textarea
                id="card-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={!canEditCards}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-assignee">Assignee</Label>
              <select
                id="card-assignee"
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                disabled={!canEditCards}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name || m.user.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="card-due">Due date</Label>
                <Input
                  id="card-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={!canEditCards}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="card-priority">Priority</Label>
                <select
                  id="card-priority"
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  disabled={!canEditCards}
                >
                  {Object.values(Priority).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-labels">Labels (comma-separated)</Label>
              <Input
                id="card-labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="bug, frontend"
                disabled={!canEditCards}
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            {canEditCards ? (
              <div className="flex gap-2">
                <Button type="submit" disabled={pending} className="flex-1">
                  {pending ? "Saving…" : "Save"}
                </Button>
                {cardDialog?.mode === "edit" && cardDialog.card ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => onDeleteCard(cardDialog.card!.id)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
