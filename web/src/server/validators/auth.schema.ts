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
