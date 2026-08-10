"use client";

import {
  useState,
  useEffect,
  FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Priority, type Role } from "@/types/enums";
import {
  createColumn,
  updateColumn,
  deleteColumn,
  moveColumn,
  updateBoard,
  type BoardDetail,
  type BoardCard,
  type BoardColumn,
} from "@/actions/board";
import { createCard, updateCard, deleteCard, moveCard } from "@/actions/card";
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

function findColumnOfCard(
  columns: BoardColumn[],
  cardId: string
): BoardColumn | undefined {
  return columns.find((c) => c.cards.some((card) => card.id === cardId));
}

function SortableColumnShell({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (args: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: CSSProperties;
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    isDragging: boolean;
  }) => ReactNode;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
    data: { type: "column" as const },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return <>{children({ setNodeRef, style, attributes, listeners, isDragging })}</>;
}

function SortableCardShell({
  id,
  columnId,
  disabled,
  children,
}: {
  id: string;
  columnId: string;
  disabled: boolean;
  children: (args: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: CSSProperties;
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    isDragging: boolean;
  }) => ReactNode;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
    data: { type: "card" as const, columnId },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return <>{children({ setNodeRef, style, attributes, listeners, isDragging })}</>;
}

function CardFace({ card }: { card: BoardCard }) {
  return (
    <>
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
    </>
  );
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

  const [columns, setColumns] = useState<BoardColumn[]>(initialBoard.columns);
  const [error, setError] = useState<string | null>(null);
  const [boardName, setBoardName] = useState(initialBoard.name);
  const [columnName, setColumnName] = useState("");
  const [pending, setPending] = useState(false);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

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

  useEffect(() => {
    setColumns(initialBoard.columns);
    setBoardName(initialBoard.name);
  }, [initialBoard]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

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
      card.dueDate ? new Date(card.dueDate).toISOString().slice(0, 10) : ""
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

  function onDragStart(event: DragStartEvent) {
    setActiveId(event.active.id);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !canEditCards) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (activeData?.type !== "card") return;

    const activeColumnId = activeData.columnId as string;
    let overColumnId: string | undefined;
    if (overData?.type === "card") {
      overColumnId = overData.columnId as string;
    } else if (overData?.type === "column") {
      overColumnId = String(over.id);
    } else if (columns.some((c) => c.id === over.id)) {
      overColumnId = String(over.id);
    }
    if (!overColumnId || activeColumnId === overColumnId) return;

    setColumns((prev) => {
      const sourceCol = prev.find((c) => c.id === activeColumnId);
      const destCol = prev.find((c) => c.id === overColumnId);
      if (!sourceCol || !destCol) return prev;
      const card = sourceCol.cards.find((c) => c.id === active.id);
      if (!card) return prev;

      return prev.map((col) => {
        if (col.id === sourceCol.id) {
          return {
            ...col,
            cards: col.cards.filter((c) => c.id !== active.id),
          };
        }
        if (col.id === destCol.id) {
          const overIndex =
            overData?.type === "card"
              ? col.cards.findIndex((c) => c.id === over.id)
              : col.cards.length;
          const nextCards = [...col.cards];
          const insertAt = overIndex < 0 ? nextCards.length : overIndex;
          nextCards.splice(insertAt, 0, card);
          return { ...col, cards: nextCards };
        }
        return col;
      });
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) {
      setColumns(initialBoard.columns);
      return;
    }

    const activeData = active.data.current;

    if (activeData?.type === "column" && canManageBoard) {
      if (active.id === over.id) return;
      const oldIndex = columns.findIndex((c) => c.id === active.id);
      let newIndex = columns.findIndex((c) => c.id === over.id);
      if (newIndex < 0) {
        const overCardCol = findColumnOfCard(columns, String(over.id));
        if (overCardCol) {
          newIndex = columns.findIndex((c) => c.id === overCardCol.id);
        }
      }
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      const previous = columns;
      const next = arrayMove(columns, oldIndex, newIndex);
      setColumns(next);

      const movedId = String(active.id);
      const idx = next.findIndex((c) => c.id === movedId);
      const beforeColumnId = idx > 0 ? next[idx - 1].id : null;
      const afterColumnId = idx < next.length - 1 ? next[idx + 1].id : null;

      const result = await moveColumn({
        organizationId,
        columnId: movedId,
        beforeColumnId,
        afterColumnId,
      });
      if (!result.ok) {
        setError(result.error);
        setColumns(previous);
        return;
      }
      refresh();
      return;
    }

    if (activeData?.type === "card" && canEditCards) {
      const snapshot = columns;
      const targetCol = findColumnOfCard(columns, String(active.id));
      if (!targetCol) {
        setColumns(initialBoard.columns);
        return;
      }

      const cardIndex = targetCol.cards.findIndex((c) => c.id === active.id);
      if (cardIndex < 0) {
        setColumns(initialBoard.columns);
        return;
      }

      // Same-column reorder if over another card in same column
      if (
        over.data.current?.type === "card" &&
        over.data.current.columnId === targetCol.id &&
        active.id !== over.id
      ) {
        const overIndex = targetCol.cards.findIndex((c) => c.id === over.id);
        if (overIndex >= 0 && overIndex !== cardIndex) {
          const nextCards = arrayMove(targetCol.cards, cardIndex, overIndex);
          setColumns((prev) =>
            prev.map((c) =>
              c.id === targetCol.id ? { ...c, cards: nextCards } : c
            )
          );
          const idx = nextCards.findIndex((c) => c.id === active.id);
          const beforeCardId = idx > 0 ? nextCards[idx - 1].id : null;
          const afterCardId =
            idx < nextCards.length - 1 ? nextCards[idx + 1].id : null;
          const result = await moveCard({
            organizationId,
            cardId: String(active.id),
            targetColumnId: targetCol.id,
            beforeCardId,
            afterCardId,
          });
          if (!result.ok) {
            setError(result.error);
            setColumns(snapshot);
            return;
          }
          refresh();
          return;
        }
      }

      // Persist current columns state (already updated by onDragOver for cross-column)
      const col = findColumnOfCard(columns, String(active.id));
      if (!col) {
        setColumns(initialBoard.columns);
        return;
      }
      const idx = col.cards.findIndex((c) => c.id === active.id);
      const beforeCardId = idx > 0 ? col.cards[idx - 1].id : null;
      const afterCardId =
        idx < col.cards.length - 1 ? col.cards[idx + 1].id : null;

      const result = await moveCard({
        organizationId,
        cardId: String(active.id),
        targetColumnId: col.id,
        beforeCardId,
        afterCardId,
      });
      if (!result.ok) {
        setError(result.error);
        setColumns(initialBoard.columns);
        return;
      }
      refresh();
    }
  }

  const activeCard =
    activeId != null
      ? columns.flatMap((c) => c.cards).find((c) => c.id === activeId)
      : undefined;
  const activeColumn =
    activeId != null ? columns.find((c) => c.id === activeId) : undefined;

  const dndEnabled = canEditCards || canManageBoard;

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
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                >
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

      <DndContext
        sensors={dndEnabled ? sensors : []}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto p-6">
          {columns.length === 0 ? (
            <p className="text-muted-foreground">
              No columns yet.
              {canManageBoard ? " Add a column to start." : null}
            </p>
          ) : null}
          <SortableContext
            items={columns.map((c) => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((col) => (
              <SortableColumnShell
                key={col.id}
                id={col.id}
                disabled={!canManageBoard}
              >
                {({ setNodeRef, style, attributes, listeners }) => (
                  <div
                    ref={setNodeRef}
                    style={style}
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
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Drag column"
                            className="cursor-grab active:cursor-grabbing"
                            {...attributes}
                            {...listeners}
                          >
                            ⋮⋮
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

                    <SortableContext
                      items={col.cards.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="flex min-h-12 flex-1 flex-col gap-2 p-3">
                        {col.cards.map((card) => (
                          <SortableCardShell
                            key={card.id}
                            id={card.id}
                            columnId={col.id}
                            disabled={!canEditCards}
                          >
                            {({
                              setNodeRef: cardRef,
                              style: cardStyle,
                              attributes: cardAttrs,
                              listeners: cardListeners,
                            }) => (
                              <li
                                ref={cardRef}
                                style={cardStyle}
                                className="rounded-lg border border-border bg-background p-3 shadow-sm"
                              >
                                <div className="flex gap-2">
                                  {canEditCards ? (
                                    <button
                                      type="button"
                                      className="mt-0.5 cursor-grab text-muted-foreground active:cursor-grabbing"
                                      aria-label="Drag card"
                                      {...cardAttrs}
                                      {...cardListeners}
                                    >
                                      ⋮⋮
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 text-left"
                                    onClick={() => openEditCard(col.id, card)}
                                  >
                                    <CardFace card={card} />
                                  </button>
                                </div>
                              </li>
                            )}
                          </SortableCardShell>
                        ))}
                      </ul>
                    </SortableContext>

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
                )}
              </SortableColumnShell>
            ))}
          </SortableContext>
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="w-72 rounded-lg border border-border bg-background p-3 shadow-lg">
              <CardFace card={activeCard} />
            </div>
          ) : activeColumn ? (
            <div className="w-72 rounded-xl border border-border bg-muted/80 p-3 shadow-lg">
              <p className="font-medium">{activeColumn.name}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
