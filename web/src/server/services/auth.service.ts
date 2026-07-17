import "server-only";

import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import type {
  EmailOtpType,
  OAuthProvider,
} from "@/server/auth/auth.adapter";
import { sanitizeNextPath } from "@/server/auth/redirect";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors/app-error";
import { env } from "@/server/env";
import { NATIVE_OAUTH_CALLBACK } from "@/lib/native-auth";

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
  // True when the password was correct but the user has 2FA enabled —
  // the session is only aal1 and the client must complete the TOTP
  // challenge (/mfa) before it gets any data access.
  needsMfa: boolean;
};

export async function signIn(input: SignInInput): Promise<AuthOperationResult> {
  const user = await authAdapter.signIn(input);
  return {
    userId: user.id,
    email: user.email ?? input.email,
    needsEmailConfirmation: false,
    // A password sign-in is always aal1; enrollment status decides
    // whether a second step is required.
    needsMfa: user.hasVerifiedTotp,
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

  try {
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
      needsMfa: false,
    };
  } catch (err) {
    // Anti-enumeration (F3): an "already registered" email must NOT be
    // distinguishable from a fresh signup. Mirror the forgot-password
    // anti-leak posture and return the same confirmation-pending shape.
    // Email confirmation is enabled, so a genuine new signup also reports
    // needsEmailConfirmation=true; the public /api/auth/signup route
    // additionally omits userId so the two responses are byte-identical.
    if (err instanceof ConflictError) {
      return {
        userId: "",
        email: input.email,
        needsEmailConfirmation: true,
        needsMfa: false,
      };
    }
    throw err;
  }
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
  // Set by the Capacitor shell: return to the app's custom-scheme deep link
  // instead of the same-origin web callback (Google blocks OAuth in embedded
  // WebViews). See lib/native-auth. Ignored on the web.
  native?: boolean;
};

export type StartOAuthResult = {
  url: string;
};

export async function startOAuth(
  input: StartOAuthInput,
): Promise<StartOAuthResult> {
  // Defend against open-redirect: only allow same-origin paths.
  const next = sanitizeNextPath(input.redirect, "/tasks");
  // Provider returns the user to the callback. We pass `next` through so the
  // callback can finish the redirect chain to the intended page.
  //   web    → same-origin /auth/callback (unchanged).
  //   native → the app's deep link; the shell then hands the code to the
  //            WebView's /auth/callback, which holds the PKCE verifier cookie.
  const redirectTo = input.native
    ? `${NATIVE_OAUTH_CALLBACK}?next=${encodeURIComponent(next)}`
    : `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`;
  return authAdapter.startOAuth({ provider: input.provider, redirectTo });
}

export async function exchangeOAuthCode(code: string): Promise<void> {
  await authAdapter.exchangeOAuthCode(code);
}

// Email-link (PKCE) code exchange. Under the PKCE flow that @supabase/ssr
// uses by default, Supabase's default email template returns the user to
// /auth/confirm with a `?code=` (the same shape as the OAuth callback),
// NOT a `token_hash`. The code-for-session exchange is identical to
// OAuth's, so we reuse the adapter's exchange behind a neutrally-named
// function so the confirm route reads honestly.
export async function exchangeEmailLinkCode(code: string): Promise<void> {
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

export type ChangePasswordInput = {
  email: string;
  currentPassword: string;
  newPassword: string;
};

// Change the password of the currently-authenticated user from Settings.
// Unlike the recovery-link reset, this VERIFIES the current password first,
// so a walk-up attacker at an unlocked screen can't silently change it. A
// wrong current password surfaces a stable `{ reason: "wrong_current_password" }`
// detail so the form can render a clear, field-specific message.
//
// The verification runs on a throwaway cookie-less client (DEV-013): a
// signIn on the cookie client would REPLACE the caller's session with a
// fresh aal1 one — and for 2FA-enrolled users the provider then refuses
// the password update itself (aal2 required).
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  try {
    await authAdapter.verifyPassword({
      email: input.email,
      password: input.currentPassword,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      throw new ValidationError("Current password is incorrect", {
        reason: "wrong_current_password",
      });
    }
    throw err;
  }

  // Set the new password on the untouched active session. The adapter maps
  // Supabase's `same_password` 422 to a { reason: "same_password" } detail —
  // though the validator already rejects new === current before we get here.
  await authAdapter.updatePassword({ password: input.newPassword });
}

// ============================================================
// MFA (TOTP) — DEV-013
// ============================================================

export type MfaEnrollResult = {
  factorId: string;
  qrCode: string;
  secret: string;
};

// Begin TOTP enrollment for the current user. Abandoned wizard runs leave
// "unverified" factors behind — and the provider rejects a second factor
// with the same friendly name — so stale unverified factors are removed
// first (allowed at any AAL) and a fresh QR is generated every time.
export async function startTotpEnrollment(): Promise<MfaEnrollResult> {
  const factors = await authAdapter.listTotpFactors();
  for (const factor of factors) {
    if (factor.status === "unverified") {
      await authAdapter.unenrollFactor(factor.id);
    }
  }
  return authAdapter.enrollTotp({
    issuer: "AVI.APP",
    friendlyName: "AVI.APP",
  });
}

export type ConfirmTotpEnrollmentInput = {
  factorId: string;
  code: string;
};

// Complete enrollment with the first authenticator code. On success the
// provider marks the factor verified AND rotates this session to aal2, so
// the user is not bounced to the challenge page right after enabling.
export async function confirmTotpEnrollment(
  input: ConfirmTotpEnrollmentInput,
): Promise<void> {
  await authAdapter.verifyTotp(input);
}

export type VerifyMfaChallengeInput = {
  code: string;
};

// Login-time challenge: locate the user's verified TOTP factor and verify
// the code against it. The client sends ONLY the code — it never chooses
// the factor.
export async function verifyMfaChallenge(
  input: VerifyMfaChallengeInput,
): Promise<void> {
  const factors = await authAdapter.listTotpFactors();
  const verified = factors.find((f) => f.status === "verified");
  if (!verified) {
    throw new ValidationError("Two-factor authentication is not set up", {
      reason: "no_verified_factor",
    });
  }
  await authAdapter.verifyTotp({ factorId: verified.id, code: input.code });
}

// Disable 2FA: remove every TOTP factor (verified removal is
// provider-gated on an aal2 session — exactly what a signed-in, verified
// MFA user has). Deliberately NO password re-auth here: a password
// sign-in would replace this session with an aal1 one, and the provider
// would then refuse the unenroll itself.
export async function disableTotp(): Promise<void> {
  const factors = await authAdapter.listTotpFactors();
  if (!factors.some((f) => f.status === "verified")) {
    throw new NotFoundError("Two-factor authentication is not enabled");
  }
  for (const factor of factors) {
    await authAdapter.unenrollFactor(factor.id);
  }
}
