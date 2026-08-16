"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  createComment,
  listCommentsForCard,
  softDeleteComment,
} from "@/actions/comment";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { MessageSquare } from "lucide-react";
import { copy } from "@/lib/copy";

type CommentItem = {
  id: string;
  body: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export function CommentThread({
  organizationId,
  cardId,
  currentUserId,
  canComment,
  canModerate,
}: {
  organizationId: string;
  cardId: string;
  currentUserId: string;
  canComment: boolean;
  canModerate: boolean;
}) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listCommentsForCard({ organizationId, cardId });
    if (!res.ok) {
      setError(res.error);
      setItems([]);
    } else {
      setItems(res.data);
    }
    setLoading(false);
  }, [organizationId, cardId]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canComment || !body.trim()) return;
    const optimistic: CommentItem = {
      id: `temp-${Date.now()}`,
      body: body.trim(),
      authorId: currentUserId,
      authorName: copy.comments.you,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    const snapshot = items;
    setItems((prev) => [...prev, optimistic]);
    setBody("");
    startTransition(async () => {
      const res = await createComment({
        organizationId,
        cardId,
        body: optimistic.body,
      });
      if (!res.ok) {
        setItems(snapshot);
        setError(res.error);
        setBody(optimistic.body);
        return;
      }
      await load();
    });
  }

  function onDelete(commentId: string) {
    startTransition(async () => {
      const snapshot = items;
      setItems((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, deletedAt: new Date().toISOString(), body: "" }
            : c
        )
      );
      const res = await softDeleteComment({ organizationId, commentId });
      if (!res.ok) {
        setItems(snapshot);
        setError(res.error);
      }
    });
  }

  return (
    <section aria-label={copy.comments.title} className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium">{copy.comments.title}</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {copy.comments.loading}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && items.length === 0 ? (
        <EmptyState
          compact
          icon={MessageSquare}
          title={copy.comments.empty}
          description={copy.comments.emptyHint}
        />
      ) : null}
      <ul className="max-h-48 space-y-2 overflow-y-auto">
        {items.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
          >
            {c.deletedAt ? (
              <p className="italic text-muted-foreground">{copy.comments.deleted}</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{c.body}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {c.authorName || copy.comments.member} ·{" "}
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                  {(canModerate || c.authorId === currentUserId) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      disabled={pending}
                      onClick={() => onDelete(c.id)}
                    >
                      {copy.common.delete}
                    </Button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {canComment ? (
        <form onSubmit={onSubmit} className="space-y-2">
          <label htmlFor={`comment-${cardId}`} className="sr-only">
            {copy.comments.add}
          </label>
          <Textarea
            id={`comment-${cardId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={copy.comments.placeholder}
            rows={2}
            maxLength={5000}
          />
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            {pending ? copy.comments.sending : copy.comments.send}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
