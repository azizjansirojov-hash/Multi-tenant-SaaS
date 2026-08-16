import { describe, expect, it } from "vitest";
import { can, type PermissionAction } from "@/lib/permissions";
import { Role } from "@/generated/prisma/client";

/**
 * Exhaustive Role × Action matrix — must match ARCHITECTURE.md / permissions.ts.
 */
const ACTIONS: PermissionAction[] = [
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
];

const EXPECTED: Record<Role, Record<PermissionAction, boolean>> = {
  OWNER: {
    manage_billing: true,
    manage_members: true,
    create_project: true,
    delete_project: true,
    delete_organization: true,
    create_card: true,
    edit_card: true,
    view_card: true,
    create_comment: true,
    delete_comment: true,
    view_activity: true,
  },
  ADMIN: {
    manage_billing: false,
    manage_members: true,
    create_project: true,
    delete_project: true,
    delete_organization: false,
    create_card: true,
    edit_card: true,
    view_card: true,
    create_comment: true,
    delete_comment: true,
    view_activity: true,
  },
  MEMBER: {
    manage_billing: false,
    manage_members: false,
    create_project: false,
    delete_project: false,
    delete_organization: false,
    create_card: true,
    edit_card: true,
    view_card: true,
    create_comment: true,
    delete_comment: true,
    view_activity: true,
  },
  VIEWER: {
    manage_billing: false,
    manage_members: false,
    create_project: false,
    delete_project: false,
    delete_organization: false,
    create_card: false,
    edit_card: false,
    view_card: true,
    create_comment: false,
    delete_comment: false,
    view_activity: true,
  },
};

describe("RBAC can() exhaustive Role×Action matrix", () => {
  for (const role of Object.values(Role)) {
    for (const action of ACTIONS) {
      it(`${role} ${EXPECTED[role][action] ? "allows" : "denies"} ${action}`, () => {
        expect(can(role, action)).toBe(EXPECTED[role][action]);
      });
    }
  }

  it("covers all Role enum values", () => {
    expect(Object.values(Role).sort()).toEqual(
      ["ADMIN", "MEMBER", "OWNER", "VIEWER"].sort()
    );
  });

  it("covers all PermissionAction values", () => {
    expect(ACTIONS.sort()).toEqual(
      [
        "create_card",
        "create_comment",
        "create_project",
        "delete_comment",
        "delete_organization",
        "delete_project",
        "edit_card",
        "manage_billing",
        "manage_members",
        "view_activity",
        "view_card",
      ].sort()
    );
  });
});
