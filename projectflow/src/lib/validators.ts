import { z } from "zod";
import { Priority, Role } from "@/generated/prisma/client";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  organizationName: z
    .string()
    .trim()
    .min(1, "Organization name is required")
    .max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
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
  name: z.string().trim().min(1).max(100).optional(),
});

export const inviteMemberSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().trim().email(),
  role: z.nativeEnum(Role).default(Role.MEMBER),
});

export const removeMembershipSchema = z.object({
  organizationId: z.string().min(1),
  membershipId: z.string().min(1),
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

export const createColumnSchema = z.object({
  organizationId: z.string().min(1),
  boardId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(200),
  position: z.number().optional(),
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
