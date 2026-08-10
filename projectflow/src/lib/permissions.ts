import type { Role } from "@/generated/prisma/client";

export type PermissionAction =
  | "manage_billing"
  | "manage_members"
  | "create_project"
  | "delete_project"
  | "create_card"
  | "edit_card"
  | "view_card";

export type PermissionResource =
  | "billing"
  | "members"
  | "project"
  | "card";

/**
 * RBAC matrix from product architecture:
 * OWNER: all
 * ADMIN: members + projects + cards (not billing)
 * MEMBER: create/edit/view cards
 * VIEWER: view cards only
 */
const matrix: Record<
  Role,
  Partial<Record<PermissionAction, boolean>>
> = {
  OWNER: {
    manage_billing: true,
    manage_members: true,
    create_project: true,
    delete_project: true,
    create_card: true,
    edit_card: true,
    view_card: true,
  },
  ADMIN: {
    manage_billing: false,
    manage_members: true,
    create_project: true,
    delete_project: true,
    create_card: true,
    edit_card: true,
    view_card: true,
  },
  MEMBER: {
    manage_billing: false,
    manage_members: false,
    create_project: false,
    delete_project: false,
    create_card: true,
    edit_card: true,
    view_card: true,
  },
  VIEWER: {
    manage_billing: false,
    manage_members: false,
    create_project: false,
    delete_project: false,
    create_card: false,
    edit_card: false,
    view_card: true,
  },
};

export function can(
  role: Role,
  action: PermissionAction,
  resource?: PermissionResource
): boolean {
  void resource;
  return matrix[role]?.[action] === true;
}
