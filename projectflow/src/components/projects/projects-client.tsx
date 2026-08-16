"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FolderKanban, FolderPlus } from "lucide-react";
import {
  createProject,
  updateProject,
  deleteProject,
} from "@/actions/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { ActionErrorMessage } from "@/components/billing/plan-limit-message";
import { copy, roleLabel } from "@/lib/copy";

type ProjectItem = {
  id: string;
  name: string;
  description: string | null;
  firstBoardId: string | null;
};

type Props = {
  organizationId: string;
  orgSlug: string;
  orgName: string;
  role: string;
  canCreate: boolean;
  canDelete: boolean;
  projects: ProjectItem[];
};

export function ProjectsClient({
  organizationId,
  orgSlug,
  orgName,
  role,
  canCreate,
  canDelete,
  projects,
}: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function openCreate() {
    setName("");
    setDescription("");
    setError(null);
    setCreateOpen(true);
  }

  function openEdit(p: ProjectItem) {
    setEditId(p.id);
    setName(p.name);
    setDescription(p.description ?? "");
    setError(null);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await createProject({
      organizationId,
      name,
      description: description || undefined,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreateOpen(false);
    router.refresh();
  }

  async function onUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setPending(true);
    setError(null);
    const result = await updateProject({
      organizationId,
      projectId: editId,
      name,
      description: description || null,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditId(null);
    router.refresh();
  }

  async function onDelete(projectId: string) {
    if (!confirm(copy.projects.deleteConfirm)) {
      return;
    }
    setError(null);
    const result = await deleteProject({ organizationId, projectId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">{orgName}</h1>
          <p className="text-body text-muted-foreground">
            {copy.projects.yourProjects} · {copy.projects.role} {roleLabel(role)}
          </p>
        </div>
        {canCreate ? (
          <>
            <Button type="button" onClick={openCreate}>
              <FolderPlus className="size-4" aria-hidden />
              {copy.projects.newProject}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{copy.projects.createProject}</DialogTitle>
                </DialogHeader>
                <form onSubmit={onCreate} className="flex flex-col gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="project-name">{copy.common.name}</Label>
                    <Input
                      id="project-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="project-desc">{copy.common.description}</Label>
                    <Textarea
                      id="project-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
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
          </>
        ) : null}
      </div>

      {error && !createOpen && !editId ? (
        <ActionErrorMessage error={error} orgSlug={orgSlug} />
      ) : null}

      {projects.length === 0 ? (
        <div className="surface-elevated">
          <EmptyState
            icon={FolderKanban}
            title={copy.projects.noProjects}
            description={copy.projects.noProjectsHint}
            action={
              canCreate ? (
                <Button type="button" onClick={openCreate}>
                  {copy.projects.createProject}
                </Button>
              ) : (
                <p className="text-small">{copy.projects.askAdmin}</p>
              )
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.id} className="surface-interactive group px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/${orgSlug}/projects/${p.id}`}
                    className="text-h3 text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.name}
                  </Link>
                  {p.description ? (
                    <p className="mt-0.5 text-body text-muted-foreground">
                      {p.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {canCreate ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(p)}
                    >
                      {copy.projects.edit}
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => onDelete(p.id)}
                    >
                      {copy.common.delete}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.projects.editProject}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onUpdate} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">{copy.common.name}</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">{copy.common.description}</Label>
              <Textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? copy.common.saving : copy.common.save}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
