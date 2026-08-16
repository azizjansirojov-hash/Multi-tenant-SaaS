import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "..");

const PRISMA_CLIENT = "@/generated/prisma/client";
const SERVER_ONLY = [
  PRISMA_CLIENT,
  "@/lib/db",
  "@/lib/stripe",
  "@/lib/realtime-bus",
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, acc);
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

function sourceOf(relFromSrc: string): string {
  return readFileSync(path.join(SRC, relFromSrc), "utf8");
}

describe("client-safe modules must not import Prisma Client", () => {
  it.each([
    "lib/validators.ts",
    "lib/change-password-form.ts",
    "lib/plan.ts",
    "lib/email-normalize.ts",
    "lib/attachment-limits.ts",
    "lib/copy.ts",
    "types/enums.ts",
  ])("%s has no Prisma Client import", (rel) => {
    const src = sourceOf(rel);
    expect(src).not.toContain(PRISMA_CLIENT);
  });
});

describe("Client Components must not import server-only modules", () => {
  it("no 'use client' file imports Prisma Client, db, stripe, or realtime-bus", () => {
    const files = walk(SRC).filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.startsWith('"use client"') || src.startsWith("'use client'");
    });
    expect(files.length).toBeGreaterThan(5);

    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const banned of SERVER_ONLY) {
        if (src.includes(banned)) {
          violations.push(`${path.relative(SRC, file)} imports ${banned}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
