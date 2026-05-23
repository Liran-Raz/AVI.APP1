import { z } from "zod";

import { emailField } from "./auth.schema";

// Team Management input schemas.
//
// Role-bearing schemas reuse the `user_role` enum from the DB. We
// deliberately restrict invitable / settable roles to `admin` and
// `employee`: owner can only be created via the bootstrap_org RPC,
// never via invitation or post-hoc promotion in the MVP.

const assignableRoleSchema = z.enum(["admin", "employee"]);

export type AssignableRole = z.infer<typeof assignableRoleSchema>;

// ============================================================
// Invite an employee/admin
// ============================================================

export const inviteSchema = z.object({
  email: emailField,
  role: assignableRoleSchema,
});

export type InvitePayload = z.infer<typeof inviteSchema>;

// ============================================================
// Change role
// ============================================================

export const changeRoleSchema = z.object({
  role: assignableRoleSchema,
});

export type ChangeRolePayload = z.infer<typeof changeRoleSchema>;

// ============================================================
// Accept invitation (raw token from URL)
// ============================================================

// Raw token validator. The token is URL-safe base64 of 32 random bytes,
// which is 43 chars without padding. We accept a generous window to
// avoid format coupling, while still rejecting obvious garbage.
const tokenField = z
  .string()
  .min(20, "Token too short")
  .max(200, "Token too long")
  .regex(/^[A-Za-z0-9_-]+$/, "Token contains invalid characters");

export const acceptInvitationSchema = z.object({
  token: tokenField,
});

export type AcceptInvitationPayload = z.infer<typeof acceptInvitationSchema>;

// ============================================================
// Signup-from-invite — the dedicated form on /invite/signup
// ============================================================

// Reuse the signup password rule from auth.schema by declaring it
// locally with the same constants. Keeping the rule in sync is a
// small, deliberate duplication — there is no clean cross-file way
// to share a private `z.string` constant without exporting it from
// auth.schema, and adding an export there would widen its surface.
const passwordSignupField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(256, "Password is too long");

const fullNameField = z
  .string()
  .trim()
  .min(1, "Full name is required")
  .max(120, "Full name is too long");

export const inviteSignupSchema = z.object({
  token: tokenField,
  password: passwordSignupField,
  fullName: fullNameField,
});

export type InviteSignupPayload = z.infer<typeof inviteSignupSchema>;
