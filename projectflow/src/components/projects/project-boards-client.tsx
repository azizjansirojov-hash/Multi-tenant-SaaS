"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { createBoard } from "@/actions/board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { ActionErrorMessage } from "@/components/billing/plan-limit-message";
import { copy } from "@/lib/copy";

type BoardItem = {
  id: string;
  name: string;
  position: number;
};

type Props = {
  organizationId: string;
  orgSlug: string;
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  canCreate: boolean;
  boards: BoardItem[];
};

export function ProjectBoardsClient({
  organizationId,
  orgSlug,
  projectId,
  projectName,
  projectDescription,
  canCreate,
  boards,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await createBoard({
      organizationId,
      projectId,
      name,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setName("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-small text-muted-foreground">
            <Link
              href={`/${orgSlug}/projects`}
              className="hover:text-foreground hover:underline"
            >
              {copy.nav.projects}
            </Link>
          </p>
          <h1 className="text-h1">{projectName}</h1>
          {projectDescription ? (
            <p className="text-body text-muted-foreground">{projectDescription}</p>
          ) : null}
        </div>
        {canCreate ? (
          <Button
            type="button"
            onClick={() => {
              setName("");
              setError(null);
              setOpen(true);
            }}
          >
            {copy.projects.newBoard}
          </Button>
        ) : null}
      </div>

      {error && !open ? (
        <ActionErrorMessage error={error} orgSlug={orgSlug} />
      ) : null}

      {boards.length === 0 ? (
        <div className="surface-elevated">
          <EmptyState
            icon={LayoutGrid}
            title={copy.projects.noBoards}
            description={copy.projects.noBoardsHint}
            action={
              canCreate ? (
                <Button type="button" onClick={() => setOpen(true)}>
                  {copy.projects.newBoard}
                </Button>
              ) : (
                <p className="text-small">{copy.projects.askAdminBoard}</p>
              )
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {boards.map((board) => (
            <li key={board.id} className="surface-interactive px-4 py-4">
              <Link
                href={`/${orgSlug}/board/${board.id}`}
                className="text-h3 text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {board.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.projects.newBoard}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onCreate} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="board-name">{copy.common.name}</Label>
              <Input
                id="board-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            {error ? (
              <ActionErrorMessage error={error} orgSlug={orgSlug} />
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? copy.common.creating : copy.common.create}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
