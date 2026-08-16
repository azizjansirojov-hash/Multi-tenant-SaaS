"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  confirmAttachment,
  createAttachmentUpload,
  deleteAttachment,
  getAttachmentDownloadUrl,
  listAttachmentsForCard,
} from "@/actions/attachment";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachment-limits";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";
import { ActionErrorMessage } from "@/components/billing/plan-limit-message";

type AttachmentItem = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploaderId: string;
  createdAt: string;
};

export function AttachmentZone({
  organizationId,
  orgSlug,
  cardId,
  canEdit,
}: {
  organizationId: string;
  orgSlug: string;
  cardId: string;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listAttachmentsForCard({ organizationId, cardId });
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

  async function uploadFile(file: File) {
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(
        `${copy.attachments.tooLarge} ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} ${copy.attachments.mbUnit}`
      );
      return;
    }
    if (
      !(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)
    ) {
      setError(
        copy.attachments.typeNotAllowed
      );
      return;
    }

    startTransition(async () => {
      const created = await createAttachmentUpload({
        organizationId,
        cardId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!created.ok) {
        setError(created.error);
        return;
      }

      if (created.data.uploadUrl.startsWith("mock://")) {
        // Local/mock storage — skip binary PUT
      } else {
        try {
          const put = await fetch(created.data.uploadUrl, {
            method: "PUT",
            headers: created.data.headers,
            body: file,
          });
          if (!put.ok) {
            setError(copy.attachments.uploadFailed);
            await deleteAttachment({
              organizationId,
              attachmentId: created.data.attachmentId,
            });
            return;
          }
        } catch {
          setError(copy.attachments.uploadFailedNet);
          await deleteAttachment({
            organizationId,
            attachmentId: created.data.attachmentId,
          });
          return;
        }
      }

      const confirmed = await confirmAttachment({
        organizationId,
        attachmentId: created.data.attachmentId,
      });
      if (!confirmed.ok) {
        setError(confirmed.error);
        return;
      }
      await load();
    });
  }

  function onFiles(files: FileList | null) {
    if (!files?.length || !canEdit) return;
    void uploadFile(files[0]);
  }

  async function onDownload(id: string) {
    const res = await getAttachmentDownloadUrl({
      organizationId,
      attachmentId: id,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.data.downloadUrl.startsWith("mock://")) {
      setError(copy.attachments.mockDownload);
      return;
    }
    window.open(res.data.downloadUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <section aria-label={copy.attachments.region} className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium">{copy.attachments.title}</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {copy.attachments.loading}
        </p>
      ) : null}
      {error ? (
        <ActionErrorMessage error={error} orgSlug={orgSlug} />
      ) : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.attachments.empty}</p>
      ) : null}
      <ul className="space-y-1">
        {items.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
          >
            <button
              type="button"
              className="min-w-0 truncate text-left underline-offset-2 hover:underline"
              onClick={() => void onDownload(a.id)}
            >
              {a.fileName}
            </button>
            {canEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteAttachment({
                      organizationId,
                      attachmentId: a.id,
                    });
                    if (!res.ok) setError(res.error);
                    else await load();
                  })
                }
              >
                {copy.attachments.remove}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={copy.attachments.dropAria}
          className={`rounded-lg border border-dashed px-3 py-6 text-center text-sm transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-border text-muted-foreground"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? copy.attachments.uploading : copy.attachments.drop}
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(",")}
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      ) : null}
    </section>
  );
}
