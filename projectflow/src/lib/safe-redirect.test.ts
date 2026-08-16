import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/safe-redirect";

describe("safeInternalPath", () => {
  it("allows relative paths starting with a single slash", () => {
    expect(safeInternalPath("/")).toBe("/");
    expect(safeInternalPath("/acme/projects")).toBe("/acme/projects");
    expect(safeInternalPath("/invite/tok?x=1")).toBe("/invite/tok?x=1");
    expect(safeInternalPath("  /login  ")).toBe("/login");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeInternalPath("https://evil.example")).toBeNull();
    expect(safeInternalPath("http://evil.example/path")).toBeNull();
    expect(safeInternalPath("//evil.example")).toBeNull();
    expect(safeInternalPath("//evil.example/phish")).toBeNull();
  });

  it("rejects backslashes and encoded slash tricks", () => {
    expect(safeInternalPath("/\\evil")).toBeNull();
    expect(safeInternalPath("/%2f%2fevil.example")).toBeNull();
    expect(safeInternalPath("/%2F%2Fevil.example")).toBeNull();
  });

  it("rejects non-strings and empty values", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath("")).toBeNull();
    expect(safeInternalPath("acme/projects")).toBeNull();
  });
});
