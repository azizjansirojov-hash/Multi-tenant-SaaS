import { z } from "zod";
import { Priority, Role } from "@/types/enums";
import { normalizeEmail } from "@/lib/email-normalize";

const emailField = z
  .string()
  .trim()
  .email("Invalid email")
  .transform(normalizeEmail);

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: emailField,
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  organizationName: z
    .string()
    .trim()
    .min(1, "Organization name is required")
    .max(100),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required").max(128),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case")
    .optional(),
});

export const updateOrganizationSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
});

export const inviteMemberSchema = z.object({
  organizationId: z.string().min(1),
  email: emailField,
  role: z.nativeEnum(Role).default(Role.MEMBER),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
});

export const removeMembershipSchema = z.object({
  organizationId: z.string().min(1),
  membershipId: z.string().min(1),
});

export const updateMembershipRoleSchema = z.object({
  organizationId: z.string().min(1),
  membershipId: z.string().min(1),
  role: z.nativeEnum(Role),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
});

export const createProjectSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).optional(),
});

export const updateProjectSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const deleteProjectSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export const createBoardSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(200),
  position: z.number().optional(),
});

export const updateBoardSchema = z.object({
  organizationId: z.string().min(1),
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
});

export const deleteBoardSchema = z.object({
  organizationId: z.string().min(1),
  boardId: z.string().min(1),
});

export const createColumnSchema = z.object({
  organizationId: z.string().min(1),
  boardId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(200),
  position: z.number().optional(),
});

export const updateColumnSchema = z.object({
  organizationId: z.string().min(1),
  columnId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
});

export const deleteColumnSchema = z.object({
  organizationId: z.string().min(1),
  columnId: z.string().min(1),
});

export const reorderColumnSchema = z.object({
  organizationId: z.string().min(1),
  columnId: z.string().min(1),
  direction: z.enum(["up", "down"]),
});

export const reorderCardSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
  direction: z.enum(["up", "down"]),
});

export const moveCardSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
  targetColumnId: z.string().min(1),
  beforeCardId: z.string().nullable(),
  afterCardId: z.string().nullable(),
});

export const moveColumnSchema = z.object({
  organizationId: z.string().min(1),
  columnId: z.string().min(1),
  beforeColumnId: z.string().nullable(),
  afterColumnId: z.string().nullable(),
});

export const createCardSchema = z.object({
  organizationId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().max(5000).optional(),
  position: z.number().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
  priority: z.nativeEnum(Priority).optional(),
  labels: z.array(z.string()).optional(),
});

export const updateCardSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  columnId: z.string().optional(),
  position: z.number().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  priority: z.nativeEnum(Priority).optional(),
  labels: z.array(z.string()).optional(),
});

export const deleteCardSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
});

export const createCheckoutSchema = z.object({
  organizationId: z.string().min(1),
});

export const listBoardsForProjectSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export const listPendingInvitationsSchema = z.object({
  organizationId: z.string().min(1),
});

export const revokeInvitationSchema = z.object({
  organizationId: z.string().min(1),
  invitationId: z.string().min(1),
});

export const leaveOrganizationSchema = z.object({
  organizationId: z.string().min(1),
});

export const deleteOrganizationSchema = z.object({
  organizationId: z.string().min(1),
  confirmName: z.string().trim().min(1, "Type the organization name to confirm"),
});

export const createCommentSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
  body: z.string().trim().min(1, "Comment is required").max(5000),
});

export const listCommentsSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
});

export const softDeleteCommentSchema = z.object({
  organizationId: z.string().min(1),
  commentId: z.string().min(1),
});

export const listNotificationsSchema = z.object({
  organizationId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  unreadOnly: z.boolean().optional(),
});

export const markNotificationReadSchema = z.object({
  organizationId: z.string().min(1),
  notificationId: z.string().min(1),
});

export const markAllNotificationsReadSchema = z.object({
  organizationId: z.string().min(1),
});

export const createAttachmentUploadSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
});

export const confirmAttachmentSchema = z.object({
  organizationId: z.string().min(1),
  attachmentId: z.string().min(1),
});

export const listAttachmentsSchema = z.object({
  organizationId: z.string().min(1),
  cardId: z.string().min(1),
});

export const deleteAttachmentSchema = z.object({
  organizationId: z.string().min(1),
  attachmentId: z.string().min(1),
});

export const getAttachmentDownloadSchema = z.object({
  organizationId: z.string().min(1),
  attachmentId: z.string().min(1),
});

export const listActivitySchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const searchCardsSchema = z.object({
  organizationId: z.string().min(1),
  boardId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  query: z.string().trim().max(200).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  priority: z.nativeEnum(Priority).optional(),
  labels: z.array(z.string().max(50)).max(20).optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
});

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function zodErrorResult(error: z.ZodError): ActionResult<never> {
  return {
    ok: false,
    error: "Validation failed",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}
