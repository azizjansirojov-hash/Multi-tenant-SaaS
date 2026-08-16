import type { Role } from "@/generated/prisma/client";

export type PermissionAction =
  | "manage_billing"
  | "manage_members"
  | "create_project"
  | "delete_project"
  | "delete_organization"
  | "create_card"
  | "edit_card"
  | "view_card"
  | "create_comment"
  | "delete_comment"
  | "view_activity";

export type PermissionResource =
  | "billing"
  | "members"
  | "project"
  | "card"
  | "comment"
  | "activity";

/**
 * RBAC matrix from product architecture:
 * OWNER: all
 * ADMIN: members + projects + cards (not billing)
 * MEMBER: create/edit/view cards + comments
 * VIEWER: view cards + activity only
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

export function can(
  role: Role,
  action: PermissionAction,
  resource?: PermissionResource
): boolean {
  void resource;
  return matrix[role]?.[action] === true;
}
