import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageNotConfiguredError } from "@/lib/env";
import {
  buildStorageKey,
  declaredMimeMatchesContent,
  MAX_ATTACHMENT_BYTES,
  mockMarkUploaded,
  sniffMagicBytes,
  validateAttachmentMeta,
  getStorage,
  resetStorageCache,
} from "@/lib/storage";
import { escapeForDisplay, sanitizePlainText } from "@/lib/action-errors";

describe("storage security properties", () => {
  const originalS3 = {
    bucket: process.env.S3_BUCKET,
    key: process.env.S3_ACCESS_KEY_ID,
    secret: process.env.S3_SECRET_ACCESS_KEY,
  };

  beforeEach(() => {
    resetStorageCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.S3_BUCKET = originalS3.bucket;
    process.env.S3_ACCESS_KEY_ID = originalS3.key;
    process.env.S3_SECRET_ACCESS_KEY = originalS3.secret;
    resetStorageCache();
  });

  it("fails closed in production when S3 is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    resetStorageCache();
    await expect(getStorage()).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("rejects disallowed MIME types", () => {
    const res = validateAttachmentMeta({
      fileName: "evil.exe",
      mimeType: "application/x-msdownload",
      sizeBytes: 100,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toContain("type");
  });

  it("rejects oversized files", () => {
    const res = validateAttachmentMeta({
      fileName: "big.pdf",
      mimeType: "application/pdf",
      sizeBytes: MAX_ATTACHMENT_BYTES + 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toContain("size");
  });

  it("rejects path-traversal and separator filenames", () => {
    expect(
      validateAttachmentMeta({
        fileName: "../secret.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }).ok
    ).toBe(false);
    expect(
      validateAttachmentMeta({
        fileName: "a/b.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }).ok
    ).toBe(false);
    expect(
      validateAttachmentMeta({
        fileName: "a\\b.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }).ok
    ).toBe(false);
  });

  it("buildStorageKey nests under org/card and sanitizes name", () => {
    const key = buildStorageKey({
      organizationId: "org1",
      cardId: "card1",
      fileName: "../../etc/passwd.png",
    });
    expect(key.startsWith("org/org1/cards/card1/")).toBe(true);
    expect(key.includes("..")).toBe(false);
  });

  it("mock signed URLs include expiry seconds and do not expose secrets", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    resetStorageCache();
    const storage = await getStorage();
    const up = await storage.createUploadUrl({
      storageKey: "org/o/cards/c/f.png",
      mimeType: "image/png",
      sizeBytes: 12,
      expiresInSeconds: 90,
    });
    expect(up.expiresInSeconds).toBe(90);
    expect(up.uploadUrl).toContain("mock://");
    expect(JSON.stringify(up)).not.toMatch(/SECRET|AKIA|password/i);

    const down = await storage.createDownloadUrl({
      storageKey: "org/o/cards/c/f.png",
      expiresInSeconds: 60,
    });
    expect(down.expiresInSeconds).toBe(60);
    expect(down.downloadUrl).toContain("mock://");
  });
});

describe("magic-byte MIME sniffing", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const gif = new TextEncoder().encode("GIF89a............");
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const pdf = new TextEncoder().encode("%PDF-1.7");
  const html = new TextEncoder().encode("<html>not an image</html>");

  it("sniffs PNG/JPEG/GIF/WebP/PDF signatures", () => {
    expect(sniffMagicBytes(png)).toBe("image/png");
    expect(sniffMagicBytes(jpeg)).toBe("image/jpeg");
    expect(sniffMagicBytes(gif)).toBe("image/gif");
    expect(sniffMagicBytes(webp)).toBe("image/webp");
    expect(sniffMagicBytes(pdf)).toBe("application/pdf");
    expect(sniffMagicBytes(html)).toBeNull();
  });

  it("rejects declared image/png when bytes are not a PNG", () => {
    expect(declaredMimeMatchesContent("image/png", html)).toBe(false);
    expect(declaredMimeMatchesContent("image/png", jpeg)).toBe(false);
    expect(declaredMimeMatchesContent("image/png", png)).toBe(true);
  });

  it("rejects PDF declaration when content is an image", () => {
    expect(declaredMimeMatchesContent("application/pdf", png)).toBe(false);
    expect(declaredMimeMatchesContent("application/pdf", pdf)).toBe(true);
  });

  it("readObjectPrefix returns stored mock bytes after upload", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    resetStorageCache();
    const storage = await getStorage();
    const key = "org/o/cards/c/spoof.png";
    mockMarkUploaded(key, {
      mimeType: "image/png",
      sizeBytes: html.byteLength,
      bytes: html,
    });
    const prefix = await storage.readObjectPrefix(key);
    expect(prefix).not.toBeNull();
    expect(declaredMimeMatchesContent("image/png", prefix!)).toBe(false);
  });
});

describe("comment XSS handling", () => {
  it("sanitizePlainText strips control chars but keeps angle brackets as text source", () => {
    const raw = "<script>alert('xss')</script>";
    const stored = sanitizePlainText(raw, 5000);
    expect(stored).toContain("<script>");
    // Escaped form must never equal raw HTML when rendered via escape
    expect(escapeForDisplay(stored)).not.toContain("<script>");
    expect(escapeForDisplay(stored)).toContain("&lt;script&gt;");
  });
});
