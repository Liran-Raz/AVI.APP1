import { z } from "zod";

import { fullNameField } from "./onboarding.schema";

// Email — RFC-loose but practical. Provider-side validation is the real
// guard; this is mostly for clear 400s on obviously bad input.
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254, "Email is too long");

// Password rules deliberately lenient at the schema layer.
// - signin: any non-empty value is fine; the auth provider does the check.
// - signup: minimum 8 chars to nudge users toward something reasonable;
//   harden later if we want zxcvbn / haveibeenpwned, etc.
const passwordSigninField = z.string().min(1, "Password is required").max(256);
const passwordSignupField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(256, "Password is too long");

export const signinSchema = z.object({
  email: emailField,
  password: passwordSigninField,
});

export const signupSchema = z.object({
  email: emailField,
  password: passwordSignupField,
  fullName: fullNameField,
});

export type SigninPayload = z.infer<typeof signinSchema>;
export type SignupPayload = z.infer<typeof signupSchema>;

// Forgot password — only the email is sent. The server intentionally
// returns the same success response whether or not the email matches a
// real user, so this schema has nothing else to validate.
export const forgotPasswordSchema = z.object({
  email: emailField,
});

export type ForgotPasswordPayload = z.infer<typeof forgotPasswordSchema>;

// Reset password — runs after the recovery-link session is set. We
// require BOTH `password` and `confirmPassword` and enforce the match
// server-side too (client-side check is UX only). Reuses the same
// password rule as signup so behavior stays consistent.
export const resetPasswordSchema = z
  .object({
    password: passwordSignupField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordPayload = z.infer<typeof resetPasswordSchema>;

// Change password (logged-in user, from Settings → אבטחה). Unlike the
// recovery-link reset, this requires the CURRENT password so the server can
// re-authenticate before changing it (a walk-up attacker at an unlocked
// screen must not be able to silently change it). New password reuses the
// signup rule (min 8) and must differ from the current one.
export const changePasswordSchema = z
  .object({
    currentPassword: passwordSigninField,
    newPassword: passwordSignupField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

export type ChangePasswordPayload = z.infer<typeof changePasswordSchema>;
