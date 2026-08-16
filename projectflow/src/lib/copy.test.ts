import { describe, expect, it } from "vitest";
import { copy, priorityLabel, roleLabel } from "@/lib/copy";

function assertNonEmptyStrings(value: unknown, path = "copy"): void {
  if (typeof value === "string") {
    expect(value.trim().length, path).toBeGreaterThan(0);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assertNonEmptyStrings(nested, `${path}.${key}`);
    }
  }
}

describe("English UI copy", () => {
  it("exposes non-empty strings for every key", () => {
    assertNonEmptyStrings(copy);
  });

  it("board action buttons are English", () => {
    expect(copy.board.rename).toBe("Rename");
    expect(copy.board.addColumn).toBe("Add column");
    expect(copy.board.addFirstColumn).toBe("Add first column");
    expect(copy.board.defaultName).toBe("Main");
    expect(copy.board.addCard).toBe("Add card");
    expect(copy.activity.button).toBe("Activity");
    expect(copy.nav.signOut).toBe("Sign out");
    expect(copy.auth.signIn).toBe("Sign in");
  });

  it("uses clear product terms for filters", () => {
    expect(copy.filters.label).toBe("Label");
    expect(copy.filters.due).toBe("Due");
    expect(copy.filters.search).toBe("Search cards…");
    expect(copy.filters.anyone).toBe("Anyone");
  });

  it("maps roles and priorities", () => {
    expect(roleLabel("OWNER")).toBe("Owner");
    expect(priorityLabel("URGENT")).toBe("Urgent");
  });
});
