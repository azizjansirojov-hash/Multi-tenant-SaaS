import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const SRC = path.join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const NODE_RUNTIME_COMMENT =
  "Requires Node.js runtime (native addon) — do not move to Edge Runtime.";

describe("bcrypt Node.js runtime guards", () => {
  it("production bcrypt importers carry the Node runtime warning comment", () => {
    const files = walk(SRC).filter((f) => !f.endsWith(".test.ts"));
    const bcryptFiles = files.filter((f) => {
      const text = fs.readFileSync(f, "utf8");
      return /from ["']bcrypt["']|import\(["']bcrypt["']\)|require\(["']bcrypt["']\)/.test(
        text
      );
    });

    expect(bcryptFiles.length).toBeGreaterThan(0);

    for (const file of bcryptFiles) {
      const text = fs.readFileSync(file, "utf8");
      expect(
        text.includes(NODE_RUNTIME_COMMENT),
        `${path.relative(process.cwd(), file)} missing Node runtime comment`
      ).toBe(true);
    }
  });

  it("Auth.js catch-all route declares export const runtime = nodejs", () => {
    const route = path.join(
      SRC,
      "app",
      "api",
      "auth",
      "[...nextauth]",
      "route.ts"
    );
    const text = fs.readFileSync(route, "utf8");
    expect(text).toMatch(/export\s+const\s+runtime\s*=\s*["']nodejs["']/);
  });

  it("middleware does not import bcrypt or auth modules that pull bcrypt", () => {
    const mw = fs.readFileSync(path.join(SRC, "middleware.ts"), "utf8");
    expect(mw).not.toMatch(/from ["']bcrypt["']/);
    expect(mw).not.toMatch(/from ["']@\/lib\/auth["']/);
    expect(mw).not.toMatch(/from ["']@\/actions\/auth["']/);
    expect(mw).toMatch(/from ["']next-auth\/jwt["']/);
  });
});
