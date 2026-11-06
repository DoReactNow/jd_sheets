// Input schemas with friendly messages (X-INPUT-01..05).
import { z } from "zod";
import { SYSTEM_ROLE_CODES } from "@/shared/rbac/defaultRoles";
import { emailSchema } from "./identity.email";
import { MAX_PASSWORD_LENGTH } from "./identity.passwords";

const password = (label: string) =>
  z
    .string({ error: `Enter ${label}.` })
    .min(1, { error: `Enter ${label}.` })
    .max(MAX_PASSWORD_LENGTH * 4, { error: "That password is too long." });

export const displayNameSchema = z
  .string({ error: "Enter a name." })
  .trim()
  .min(1, { error: "Enter a name." })
  .max(100, { error: "Names can be up to 100 characters." })
  .refine((value) => !/\p{Cc}/u.test(value), { error: "Names can't contain special characters." });

export const roleSchema = z.enum(SYSTEM_ROLE_CODES, { error: "Choose a role." });

export const signInInput = z.object({
  email: z
    .string({ error: "Enter your email address." })
    .trim()
    .min(1, { error: "Enter your email address." })
    .max(254),
  password: password("your password"),
});

export const changePasswordInput = z.object({
  currentPassword: password("your current password"),
  newPassword: password("a new password"),
});

export const signupRequestInput = z.object({ email: emailSchema });

export const signupVerifyInput = z.object({
  email: emailSchema,
  code: z
    .string({ error: "Enter the code from the email." })
    .trim()
    .regex(/^\d{6}$/, { error: "The code is 6 digits." }),
});

export const signupCompleteInput = z.object({
  ticket: z.string().min(20).max(100),
  displayName: displayNameSchema,
  password: password("a password"),
});

export const approveInput = z.object({ role: roleSchema });

export const userListInput = z.object({
  status: z.enum(["PENDING_APPROVAL", "ACTIVE", "REJECTED", "DEACTIVATED"]).optional(),
  role: roleSchema.optional(),
  q: z.string().max(100).optional(),
});

export const createUserInput = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  role: roleSchema,
  temporaryPassword: z
    .string()
    .max(MAX_PASSWORD_LENGTH * 4)
    .optional(),
});

export const updateUserInput = z
  .object({ displayName: displayNameSchema.optional(), role: roleSchema.optional() })
  .refine((value) => value.displayName !== undefined || value.role !== undefined, {
    error: "Change the name or the role.",
  });

export const resetPasswordInput = z.object({
  temporaryPassword: z
    .string()
    .max(MAX_PASSWORD_LENGTH * 4)
    .optional(),
});

// --- groups (Phase 2) -------------------------------------------------------------------------

export const groupNameSchema = z
  .string({ error: "Enter a group name." })
  .trim()
  .min(1, { error: "Enter a group name." })
  .max(80, { error: "Group names can be up to 80 characters." })
  .refine((value) => !/\p{Cc}/u.test(value), {
    error: "Group names can't contain special characters.",
  });

export const groupInput = z.object({ name: groupNameSchema });

export const groupListInput = z.object({ q: z.string().trim().max(80).optional() });

export const addMembersInput = z.object({
  userIds: z
    .array(z.uuid({ error: "Choose people from the list." }), { error: "Choose people to add." })
    .min(1, { error: "Choose people to add." })
    .max(200, { error: "Add up to 200 people at a time." }),
});
