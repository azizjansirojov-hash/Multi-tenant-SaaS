import { describe, expect, it } from "vitest";
import {
  sanitizePlainText,
  escapeForDisplay,
  safeActionError,
} from "@/lib/action-errors";
import { StorageNotConfiguredError } from "@/lib/env";

describe("action-errors helpers", () => {
  it("sanitizePlainText strips control chars and truncates", () => {
    expect(sanitizePlainText("hello\u0000world", 100)).toBe("helloworld");
    expect(sanitizePlainText("abcdefghij", 5)).toBe("abcde");
  });

  it("escapeForDisplay escapes HTML metacharacters", () => {
    expect(escapeForDisplay(`<script>alert("x")</script>`)).toContain("&lt;");
    expect(escapeForDisplay(`<script>alert("x")</script>`)).not.toContain(
      "<script>"
    );
  });

  it("safeActionError never leaks stacks", () => {
    const err = new Error("secret db connection string");
    err.stack = "STACKTRACE";
    const res = safeActionError(err);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Something went wrong");
      expect(res.error).not.toContain("STACKTRACE");
      expect(res.error).not.toContain("secret");
    }
  });

  it("safeActionError maps known auth messages", () => {
    expect(safeActionError(new Error("Unauthorized"))).toEqual({
      ok: false,
      error: "Unauthorized",
    });
    expect(safeActionError(new Error("Access denied"))).toEqual({
      ok: false,
      error: "Access denied",
    });
  });

  it("safeActionError maps StorageNotConfiguredError to a safe message", () => {
    expect(safeActionError(new StorageNotConfiguredError())).toEqual({
      ok: false,
      error: "File storage is not configured",
    });
  });
});
