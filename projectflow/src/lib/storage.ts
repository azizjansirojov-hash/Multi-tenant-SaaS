import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
  type AllowedMimeType,
} from "@/lib/attachment-limits";
import { isProduction, s3Configured, StorageNotConfiguredError } from "@/lib/env";

export {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
};
export type { AllowedMimeType };

/**
 * S3-compatible object storage abstraction.
 * Uses AWS SDK when S3_* env vars are set; otherwise an in-memory mock for tests/dev.
 * Never expose raw credentials to the client — only short-lived signed URLs.
 *
 * Attachment object lifecycle (pairs with Attachment.status in Prisma):
 * - Presign (`createUploadUrl`) does not require the object to exist yet.
 * - Client PUTs bytes to the signed URL; keys live under org/.../cards/...
 * - On confirm, metadata becomes CONFIRMED; on delete / pending TTL cleanup,
 *   `deleteObject` removes the blob (best-effort) before or with the DB row.
 * - Abandoned PENDING uploads: opportunistic cleanup deletes storage objects
 *   whose metadata is still PENDING past ATTACHMENT_PENDING_TTL_HOURS.
 */

/** Bytes read from object start for magic-number sniffing. */
export const OBJECT_PREFIX_BYTES = 64;

const IMAGE_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const OOXML_MIME_TYPES = new Set<string>([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const OLE_OFFICE_MIME_TYPES = new Set<string>([
  "application/msword",
  "application/vnd.ms-excel",
]);

const TEXT_MIME_TYPES = new Set<string>(["text/plain", "text/markdown"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * Identify a well-known type from leading bytes. Returns null when the
 * prefix is not a recognized signature (typical for text/markdown).
 *
 * Full antivirus-style scanning is out of scope: this process has no AV
 * engine, and even a scanner cannot guarantee zero-day coverage. Magic-byte
 * verification is the practical minimum bar — it stops a file declared as
 * `image/png` (or other allow-listed type) from being CONFIRMED when the
 * content is clearly something else.
 */
export function sniffMagicBytes(head: Uint8Array): string | null {
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return "image/png";
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (head.length >= 6) {
    const gif = ascii(head, 0, 6);
    if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  }
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (head.length >= 4 && ascii(head, 0, 4) === "%PDF") {
    return "application/pdf";
  }
  if (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07) &&
    (head[3] === 0x04 || head[3] === 0x06 || head[3] === 0x08)
  ) {
    return "application/zip";
  }
  if (
    head.length >= 4 &&
    head[0] === 0xd0 &&
    head[1] === 0xcf &&
    head[2] === 0x11 &&
    head[3] === 0xe0
  ) {
    return "application/x-ole-storage";
  }
  return null;
}

/** True when leading bytes are consistent with the declared allow-listed MIME. */
export function declaredMimeMatchesContent(
  declaredMime: string,
  head: Uint8Array
): boolean {
  if (!isAllowedMimeType(declaredMime)) return false;
  const sniffed = sniffMagicBytes(head);

  if (IMAGE_MIME_TYPES.has(declaredMime)) {
    return sniffed === declaredMime;
  }
  if (declaredMime === "application/pdf") {
    return sniffed === "application/pdf";
  }
  if (OOXML_MIME_TYPES.has(declaredMime)) {
    return sniffed === "application/zip";
  }
  if (OLE_OFFICE_MIME_TYPES.has(declaredMime)) {
    return sniffed === "application/x-ole-storage";
  }
  if (TEXT_MIME_TYPES.has(declaredMime)) {
    // Text has no reliable signature; still refuse known binary/image/pdf.
    return sniffed === null;
  }
  return false;
}

export function validateAttachmentMeta(input: {
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}): { ok: true } | { ok: false; error: string } {
  const name = input.fileName.trim();
  if (!name || name.length > 255) {
    return { ok: false, error: "Invalid file name" };
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return { ok: false, error: "Invalid file name" };
  }
  if (!isAllowedMimeType(input.mimeType)) {
    return {
      ok: false,
      error: "File type not allowed. Use images, PDF, text, or Office documents.",
    };
  }
  if (
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_ATTACHMENT_BYTES
  ) {
    return {
      ok: false,
      error: `File exceeds maximum size of ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`,
    };
  }
  return { ok: true };
}

export type SignedUpload = {
  uploadUrl: string;
  storageKey: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
};

export type SignedDownload = {
  downloadUrl: string;
  expiresInSeconds: number;
};

export interface ObjectStorage {
  createUploadUrl(opts: {
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload>;
  createDownloadUrl(opts: {
    storageKey: string;
    expiresInSeconds?: number;
  }): Promise<SignedDownload>;
  deleteObject(storageKey: string): Promise<void>;
  /** True if the object is present in storage (used before confirming uploads). */
  objectExists(storageKey: string): Promise<boolean>;
  /**
   * Leading bytes of the object, or null if missing/unreadable.
   * Used for magic-byte MIME verification on confirm (not S3 Content-Type:
   * that header is typically the client-declared type from the presigned PUT).
   */
  readObjectPrefix(
    storageKey: string,
    maxBytes?: number
  ): Promise<Uint8Array | null>;
}

type MockStore = Map<
  string,
  { mimeType: string; sizeBytes: number; bytes?: Uint8Array }
>;

const globalMock = globalThis as unknown as { __syzxMockStorage?: MockStore };

function getMockStore(): MockStore {
  if (!globalMock.__syzxMockStorage) {
    globalMock.__syzxMockStorage = new Map();
  }
  return globalMock.__syzxMockStorage;
}

function createMockStorage(): ObjectStorage {
  const store = getMockStore();
  return {
    async createUploadUrl({ storageKey, mimeType, sizeBytes: _sizeBytes, expiresInSeconds = 300 }) {
      void _sizeBytes;
      // Presign only — do not mark object as uploaded until mockMarkUploaded / real PUT
      return {
        uploadUrl: `mock://upload/${encodeURIComponent(storageKey)}`,
        storageKey,
        headers: { "Content-Type": mimeType },
        expiresInSeconds,
      };
    },
    async createDownloadUrl({ storageKey, expiresInSeconds = 120 }) {
      if (!store.has(storageKey)) {
        return {
          downloadUrl: `mock://download/${encodeURIComponent(storageKey)}`,
          expiresInSeconds,
        };
      }
      return {
        downloadUrl: `mock://download/${encodeURIComponent(storageKey)}`,
        expiresInSeconds,
      };
    },
    async deleteObject(storageKey) {
      store.delete(storageKey);
    },
    async objectExists(storageKey) {
      return store.has(storageKey);
    },
    async readObjectPrefix(storageKey, maxBytes = OBJECT_PREFIX_BYTES) {
      const obj = store.get(storageKey);
      if (!obj) return null;
      const bytes = obj.bytes ?? new Uint8Array(0);
      return bytes.slice(0, maxBytes);
    },
  };
}

/** Test helper: simulate a completed client PUT into mock storage. */
export function mockMarkUploaded(
  storageKey: string,
  meta: { mimeType: string; sizeBytes: number; bytes?: Uint8Array }
): void {
  getMockStore().set(storageKey, meta);
}

async function createS3Storage(): Promise<ObjectStorage> {
  const {
    S3Client,
    DeleteObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
  } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const bucket = process.env.S3_BUCKET!;
  const client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });

  return {
    async createUploadUrl({ storageKey, mimeType, sizeBytes, expiresInSeconds = 300 }) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      });
      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
      });
      return {
        uploadUrl,
        storageKey,
        headers: { "Content-Type": mimeType },
        expiresInSeconds,
      };
    },
    async createDownloadUrl({ storageKey, expiresInSeconds = 120 }) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      });
      const downloadUrl = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
      });
      return { downloadUrl, expiresInSeconds };
    },
    async deleteObject(storageKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: storageKey })
      );
    },
    async objectExists(storageKey) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: storageKey })
        );
        return true;
      } catch {
        return false;
      }
    },
    async readObjectPrefix(storageKey, maxBytes = OBJECT_PREFIX_BYTES) {
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: storageKey,
            Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
          })
        );
        if (!res.Body) return null;
        return await res.Body.transformToByteArray();
      } catch {
        return null;
      }
    },
  };
}

let cached: ObjectStorage | null = null;

export async function getStorage(): Promise<ObjectStorage> {
  if (cached) return cached;
  if (s3Configured()) {
    cached = await createS3Storage();
  } else if (isProduction()) {
    throw new StorageNotConfiguredError();
  } else {
    cached = createMockStorage();
  }
  return cached;
}

/** Reset cached client (tests). */
export function resetStorageCache(): void {
  cached = null;
}

export function buildStorageKey(opts: {
  organizationId: string;
  cardId: string;
  fileName: string;
}): string {
  const safe = opts.fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.\./g, "_")
    .slice(0, 180);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `org/${opts.organizationId}/cards/${opts.cardId}/${id}-${safe}`;
}
