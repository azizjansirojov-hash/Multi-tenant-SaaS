import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validators";
import { can } from "@/lib/permissions";
import {
  getStorage,
  mockMarkUploaded,
  resetStorageCache,
  validateAttachmentMeta,
} from "@/lib/storage";

describe("audit: password rules (server Zod)", () => {
  it("rejects register password shorter than 8 and longer than 128", () => {
    expect(
      registerSchema.safeParse({
        name: "A",
        email: "a@example.com",
        password: "short",
        organizationName: "Org",
      }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        name: "A",
        email: "a@example.com",
        password: "x".repeat(129),
        organizationName: "Org",
      }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        name: "A",
        email: "a@example.com",
        password: "longenough",
        organizationName: "Org",
      }).success
    ).toBe(true);
  });

  it("login password requires min 1 and max 128", () => {
    expect(
      loginSchema.safeParse({ email: "a@example.com", password: "" }).success
    ).toBe(false);
    expect(
      loginSchema.safeParse({
        email: "a@example.com",
        password: "x".repeat(129),
      }).success
    ).toBe(false);
    expect(
      loginSchema.safeParse({ email: "a@example.com", password: "ok" }).success
    ).toBe(true);
  });
});

describe("audit: RBAC matrix snapshot", () => {
  const roles = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
  const actions = [
    "manage_billing",
    "manage_members",
    "create_project",
    "delete_project",
    "delete_organization",
    "create_card",
    "edit_card",
    "view_card",
    "create_comment",
    "delete_comment",
    "view_activity",
  ] as const;

  it("VIEWER cannot mutate cards/projects/members/billing", () => {
    expect(can("VIEWER", "create_card")).toBe(false);
    expect(can("VIEWER", "edit_card")).toBe(false);
    expect(can("VIEWER", "create_comment")).toBe(false);
    expect(can("VIEWER", "create_project")).toBe(false);
    expect(can("VIEWER", "manage_members")).toBe(false);
    expect(can("VIEWER", "manage_billing")).toBe(false);
    expect(can("VIEWER", "view_card")).toBe(true);
    expect(can("VIEWER", "view_activity")).toBe(true);
  });

  it("ADMIN cannot manage billing; MEMBER cannot manage members/projects", () => {
    expect(can("ADMIN", "manage_billing")).toBe(false);
    expect(can("ADMIN", "delete_organization")).toBe(false);
    expect(can("ADMIN", "manage_members")).toBe(true);
    expect(can("MEMBER", "manage_members")).toBe(false);
    expect(can("MEMBER", "create_project")).toBe(false);
    expect(can("MEMBER", "edit_card")).toBe(true);
  });

  it("OWNER has all actions", () => {
    for (const action of actions) {
      expect(can("OWNER", action)).toBe(true);
    }
  });

  it("matrix is exhaustive for all role/action pairs (no undefined gaps)", () => {
    for (const role of roles) {
      for (const action of actions) {
        expect(typeof can(role, action)).toBe("boolean");
      }
    }
  });
});

describe("audit: attachment confirm requires uploaded object (H1)", () => {
  it("objectExists is false until mockMarkUploaded; true after", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    resetStorageCache();
    const storage = await getStorage();
    const key = "org/audit/cards/c/pending.png";
    const up = await storage.createUploadUrl({
      storageKey: key,
      mimeType: "image/png",
      sizeBytes: 10,
    });
    expect(up.storageKey).toBe(key);
    expect(await storage.objectExists(key)).toBe(false);
    mockMarkUploaded(key, { mimeType: "image/png", sizeBytes: 10 });
    expect(await storage.objectExists(key)).toBe(true);
    await storage.deleteObject(key);
    expect(await storage.objectExists(key)).toBe(false);
  });

  it("spoofed disallowed MIME is rejected by validateAttachmentMeta", () => {
    expect(
      validateAttachmentMeta({
        fileName: "x.png",
        mimeType: "application/javascript",
        sizeBytes: 100,
      }).ok
    ).toBe(false);
  });
});
