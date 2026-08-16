"use client";

import {
  useState,
  useEffect,
  useCallback,
  FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Columns3, SearchX } from "lucide-react";
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
import { copy, priorityLabel } from "@/lib/copy";
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
import { CommentThread } from "@/components/comments/comment-thread";
import { AttachmentZone } from "@/components/attachments/attachment-zone";
import { ActivityFeed } from "@/components/activity/activity-feed";
import {
  BoardFilters,
  type BoardFilterState,
} from "@/components/board/board-filters";
import { EmptyState } from "@/components/empty-state";
import { useRealtime } from "@/hooks/use-realtime";
import { can as canPerm } from "@/lib/permissions";
import { cn } from "@/lib/utils";

function priorityBadgeClass(priority: string) {
  switch (priority) {
    case Priority.URGENT:
    case Priority.HIGH:
      return "border-primary/40 bg-primary/15 text-primary";
    case Priority.MEDIUM:
      return "border-primary/25 bg-primary/8 text-foreground";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

type Props = {
  organizationId: string;
  orgSlug: string;
  role: Role;
  board: BoardDetail;
  members: MemberListItem[];
  currentUserId: string;
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
      <p className="text-h3">{card.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge
          variant="outline"
          className={cn(priorityBadgeClass(card.priority))}
        >
          {card.priority}
        </Badge>
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
  currentUserId,
}: Props) {
  const router = useRouter();
  const canManageBoard = role === "OWNER" || role === "ADMIN";
  const canEditCards =
    role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const canComment = canPerm(role, "create_comment", "comment");
  const canModerateComments = canPerm(role, "delete_comment", "comment");

  const [columns, setColumns] = useState<BoardColumn[]>(initialBoard.columns);
  const [error, setError] = useState<string | null>(null);
  const [boardName, setBoardName] = useState(initialBoard.name);
  const [columnName, setColumnName] = useState("");
  const [pending, setPending] = useState(false);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [filterIds, setFilterIds] = useState<string[] | null>(null);

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

  useRealtime({
    organizationId,
    boardId: initialBoard.id,
  });

  useEffect(() => {
    setColumns(initialBoard.columns);
    setBoardName(initialBoard.name);
  }, [initialBoard]);

  const onFilterChange = useCallback((state: BoardFilterState) => {
    setFilterIds(state.matchingIds);
  }, []);

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
    if (!confirm(copy.board.deleteColumnConfirm)) return;
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
    if (!confirm(copy.board.deleteCardConfirm)) return;
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

  const visibleCardCount =
    filterIds === null
      ? columns.reduce((n, c) => n + c.cards.length, 0)
      : filterIds.length;
  const showFilterEmpty =
    columns.length > 0 && filterIds !== null && visibleCardCount === 0;

  return (
    <div className="flex h-full min-h-[calc(100vh-3.5rem)] flex-col">
      <header className="border-b border-border px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-small">{initialBoard.projectName}</p>
            {canManageBoard ? (
              <form
                onSubmit={onRenameBoard}
                className="flex flex-wrap items-center gap-2"
              >
                <Input
                  value={boardName}
                  onChange={(e) => setBoardName(e.target.value)}
                  className="max-w-xs text-h2"
                  aria-label={copy.board.boardName}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                >
                  {copy.board.rename}
                </Button>
              </form>
            ) : (
              <h1 className="text-h1">{initialBoard.name}</h1>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageBoard ? (
              <form onSubmit={onAddColumn} className="flex items-center gap-2">
                <Label htmlFor="new-col" className="sr-only">
                  {copy.board.columnName}
                </Label>
                <Input
                  id="new-col"
                  placeholder={copy.board.newColumn}
                  value={columnName}
                  onChange={(e) => setColumnName(e.target.value)}
                  required
                  className="w-40"
                />
                <Button type="submit" disabled={pending}>
                  {copy.board.addColumn}
                </Button>
              </form>
            ) : null}
            <ActivityFeed
              organizationId={organizationId}
              projectId={initialBoard.projectId}
            />
          </div>
        </div>
        <div className="mt-4">
          <BoardFilters
            organizationId={organizationId}
            boardId={initialBoard.id}
            members={members}
            onFilterChange={onFilterChange}
          />
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
        <div className="flex flex-1 gap-4 overflow-x-auto p-4 sm:p-6">
          {columns.length === 0 ? (
            <div className="surface-elevated m-auto w-full max-w-md">
              <EmptyState
                icon={Columns3}
                title={copy.board.noColumns}
                description={copy.board.noColumnsHint}
                action={
                  canManageBoard ? (
                    <Button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("new-col");
                        el?.focus();
                      }}
                    >
                      {copy.board.addFirstColumn}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : null}
          {showFilterEmpty ? (
            <div className="surface-elevated m-auto w-full max-w-md">
              <EmptyState
                icon={SearchX}
                title={copy.board.noMatchingCards}
                description={copy.board.noMatchingHint}
              />
            </div>
          ) : (
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
                    className="surface-elevated flex w-72 shrink-0 flex-col bg-muted/20"
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
                            aria-label={copy.board.dragColumn}
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
                            aria-label={copy.board.deleteColumn}
                          >
                            ×
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <SortableContext
                      items={col.cards
                        .filter(
                          (card) =>
                            filterIds === null || filterIds.includes(card.id)
                        )
                        .map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="flex min-h-12 flex-1 flex-col gap-2 p-3">
                        {col.cards
                          .filter(
                            (card) =>
                              filterIds === null || filterIds.includes(card.id)
                          )
                          .map((card) => (
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
                                className="surface-interactive rounded-lg bg-card p-3"
                              >
                                <div className="flex gap-2">
                                  {canEditCards ? (
                                    <button
                                      type="button"
                                      className="mt-0.5 cursor-grab text-muted-foreground active:cursor-grabbing"
                                      aria-label={copy.board.dragCard}
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
                          {copy.board.addCard}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </SortableColumnShell>
            ))}
          </SortableContext>
          )}
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="surface-elevated w-72 bg-card p-3 shadow-lg">
              <CardFace card={activeCard} />
            </div>
          ) : activeColumn ? (
            <div className="surface-elevated w-72 bg-muted/80 p-3 shadow-lg">
              <p className="text-h3">{activeColumn.name}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog
        open={!!cardDialog}
        onOpenChange={(o) => !o && setCardDialog(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {cardDialog?.mode === "edit" ? copy.board.editCard : copy.board.newCard}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSaveCard} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="card-title">{copy.board.title}</Label>
              <Input
                id="card-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={!canEditCards}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-desc">{copy.common.description}</Label>
              <Textarea
                id="card-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={!canEditCards}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-assignee">{copy.board.assignee}</Label>
              <select
                id="card-assignee"
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                disabled={!canEditCards}
              >
                <option value="">{copy.board.unassigned}</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name || m.user.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="card-due">{copy.board.dueDate}</Label>
                <Input
                  id="card-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={!canEditCards}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="card-priority">{copy.board.priority}</Label>
                <select
                  id="card-priority"
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  disabled={!canEditCards}
                >
                  {Object.values(Priority).map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-labels">{copy.board.labels}</Label>
              <Input
                id="card-labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder={copy.board.labelsPlaceholder}
                disabled={!canEditCards}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {canEditCards ? (
              <div className="flex gap-2">
                <Button type="submit" disabled={pending} className="flex-1">
                  {pending ? copy.common.saving : copy.common.save}
                </Button>
                {cardDialog?.mode === "edit" && cardDialog.card ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => onDeleteCard(cardDialog.card!.id)}
                  >
                    {copy.common.delete}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </form>
          {cardDialog?.mode === "edit" && cardDialog.card ? (
            <>
              <CommentThread
                organizationId={organizationId}
                cardId={cardDialog.card.id}
                currentUserId={currentUserId}
                canComment={canComment}
                canModerate={canModerateComments}
              />
              <AttachmentZone
                organizationId={organizationId}
                orgSlug={orgSlug}
                cardId={cardDialog.card.id}
                canEdit={canEditCards}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
