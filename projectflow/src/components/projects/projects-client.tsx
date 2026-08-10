"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
    if (!confirm("Delete this project and all boards, columns, and cards?")) {
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
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{orgName}</h1>
          <p className="text-sm text-muted-foreground">
            Projects · role {role}{" "}
            <Link
              href={`/${orgSlug}/settings/members`}
              className="ml-2 underline"
            >
              Members
            </Link>
          </p>
        </div>
        {canCreate ? (
          <>
            <Button type="button" onClick={openCreate}>
              New project
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Create project</DialogTitle>
                </DialogHeader>
                <form onSubmit={onCreate} className="flex flex-col gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="project-name">Name</Label>
                    <Input
                      id="project-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="project-desc">Description</Label>
                    <Textarea
                      id="project-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                    />
                  </div>
                  {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                  ) : null}
                  <Button type="submit" disabled={pending}>
                    {pending ? "Creating…" : "Create"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </div>

      {error && !createOpen && !editId ? (
        <p className="mt-4 text-sm text-destructive">{error}</p>
      ) : null}

      {projects.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-lg font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first project to get a default board.
          </p>
          {canCreate ? (
            <Button type="button" className="mt-4" onClick={openCreate}>
              Create project
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Ask an admin to create a project.
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                {p.firstBoardId ? (
                  <Link
                    href={`/${orgSlug}/board/${p.firstBoardId}`}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-medium">{p.name}</span>
                )}
                {p.description ? (
                  <p className="text-sm text-muted-foreground">{p.description}</p>
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
                    Edit
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(p.id)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>
          <form onSubmit={onUpdate} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
