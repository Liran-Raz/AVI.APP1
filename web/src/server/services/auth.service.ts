import "server-only";

import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import type {
  EmailOtpType,
  OAuthProvider,
} from "@/server/auth/auth.adapter";
import { sanitizeNextPath } from "@/server/auth/redirect";
import { env } from "@/server/env";

// Auth service — the only consumer of AuthAdapter for sign-in/up/out,
// OAuth, and email OTP flows. API routes call these functions; they
// never touch the adapter or the supabase client directly.
//
// Each function returns a small DTO with the safe fields only. We do
// NOT return access tokens, refresh tokens, or raw provider objects.

export type SignInInput = {
  email: string;
  password: string;
};

export type SignUpInput = {
  email: string;
  password: string;
  fullName: string;
  // Optional post-confirmation path (must be a same-origin path
  // starting with "/"). Defaults to "/onboarding" if omitted. Callers
  // are responsible for validating this — the public /api/auth/signup
  // endpoint does NOT expose it; only internal callers (e.g. the
  // invite-signup route, which derives the path from a server-validated
  // invitation token) may set it.
  next?: string;
};

export type AuthOperationResult = {
  userId: string;
  email: string;
  needsEmailConfirmation: boolean;
};

export async function signIn(input: SignInInput): Promise<AuthOperationResult> {
  const user = await authAdapter.signIn(input);
  return {
    userId: user.id,
    email: user.email ?? input.email,
    needsEmailConfirmation: false,
  };
}

export async function signUp(input: SignUpInput): Promise<AuthOperationResult> {
  // Default: after email confirmation the user lands on /onboarding
  // to create their own org. For invite-driven signup, the caller
  // passes `next=/invite/accept?token=...` so the user lands directly
  // on the acceptance page after confirming.
  const nextPath = sanitizeNextPath(input.next, "/onboarding");
  const emailRedirectTo =
    `${env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=${encodeURIComponent(nextPath)}`;

  const result = await authAdapter.signUp({
    email: input.email,
    password: input.password,
    fullName: input.fullName,
    emailRedirectTo,
  });
  return {
    userId: result.user.id,
    email: result.user.email ?? input.email,
    needsEmailConfirmation: result.needsEmailConfirmation,
  };
}

export async function signOut(): Promise<void> {
  await authAdapter.signOut();
}

// ============================================================
// OAuth + email confirmation
// ============================================================

export type StartOAuthInput = {
  provider: OAuthProvider;
  // Optional post-login path (e.g., the route the user was originally
  // trying to reach). Validated to be a same-origin path.
  redirect?: string;
};

export type StartOAuthResult = {
  url: string;
};

export async function startOAuth(
  input: StartOAuthInput,
): Promise<StartOAuthResult> {
  // Defend against open-redirect: only allow same-origin paths.
  const next = sanitizeNextPath(input.redirect, "/tasks");
  // Provider returns the user to /auth/callback. We pass `next` through
  // so the callback can finish the redirect chain to the intended page.
  const redirectTo =
    `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`;
  return authAdapter.startOAuth({ provider: input.provider, redirectTo });
}

export async function exchangeOAuthCode(code: string): Promise<void> {
  await authAdapter.exchangeOAuthCode(code);
}

export type VerifyEmailOtpInput = {
  tokenHash: string;
  type: EmailOtpType;
};

export async function verifyEmailOtp(
  input: VerifyEmailOtpInput,
): Promise<void> {
  await authAdapter.verifyEmailOtp(input);
}

// ============================================================
// Password reset
// ============================================================

export type RequestPasswordResetInput = {
  email: string;
};

// Anti-leak: always return success regardless of whether the email
// belongs to a real user OR whether the provider call actually
// succeeded. Provider errors are logged server-side so an operator can
// still see SMTP misconfig / outages without exposing variance to the
// client (which could be used to enumerate accounts or detect outages).
export async function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<void> {
  const redirectTo =
    `${env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/reset-password`;
  try {
    await authAdapter.sendPasswordReset({
      email: input.email,
      redirectTo,
    });
  } catch (err) {
    // Swallow — caller MUST see a uniform success response.
    console.error("[auth.service.requestPasswordReset] swallowed:", err);
  }
}

export type ResetPasswordInput = {
  password: string;
};

// Update the password of the currently authenticated user. The caller
// (API route) is expected to enforce session via requireUser(). The
// adapter throws UnauthorizedError if the recovery session is missing
// or expired by the time we get here.
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  await authAdapter.updatePassword({ password: input.password });
}
