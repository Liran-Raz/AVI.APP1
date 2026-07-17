import "server-only";

import {
  createSupabaseServerClient,
  createSupabaseStatelessAuthClient,
} from "@/server/db/supabase";
import {
  AppError,
  ConflictError,
  MfaRequiredError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors/app-error";
import type {
  AalLevel,
  AuthAdapter,
  AuthUser,
  CurrentUserWithMfa,
  EnrollTotpInput,
  SendPasswordResetInput,
  SignInInput,
  SignUpInput,
  SignUpResult,
  StartOAuthInput,
  StartOAuthResult,
  TotpEnrollment,
  TotpFactor,
  UpdatePasswordInput,
  VerifyEmailOtpInput,
  VerifyPasswordInput,
  VerifyTotpInput,
} from "./auth.adapter";

// Supabase implementation of AuthAdapter.
// Only this file imports @supabase/* for auth purposes. Replace this
// module to swap providers (e.g. Firebase Auth) without touching the
// rest of the codebase.

type SupabaseMfaFactor = {
  id: string;
  friendly_name?: string | null;
  factor_type: string;
  status: string;
  created_at?: string | null;
};

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
  factors?: SupabaseMfaFactor[] | null;
};

function hasVerifiedTotpFactor(u: SupabaseAuthUser): boolean {
  return (u.factors ?? []).some(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
}

function toAuthUser(u: SupabaseAuthUser): AuthUser {
  return {
    id: u.id,
    email: u.email ?? null,
    emailConfirmedAt: u.email_confirmed_at ?? null,
    metadata: u.user_metadata ?? {},
    hasVerifiedTotp: hasVerifiedTotpFactor(u),
  };
}

class SupabaseAuthAdapter implements AuthAdapter {
  async getCurrentUser(): Promise<AuthUser | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return toAuthUser(data.user);
  }

  async signIn(input: SignInInput): Promise<AuthUser> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      // 400 = invalid credentials. Use a generic message so we don't
      // leak whether the email exists vs the password was wrong.
      if (error.status === 400) {
        throw new UnauthorizedError("Invalid email or password");
      }
      if (error.status === 422) {
        throw new ValidationError(error.message);
      }
      console.error("[supabase-auth.signIn] unexpected error", {
        status: error.status,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Sign-in failed");
    }

    if (!data.user) {
      // Shouldn't happen on success path, but defend against it.
      throw new AppError("INTERNAL_ERROR", "Sign-in returned no user");
    }

    return toAuthUser(data.user);
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: input.emailRedirectTo,
        data: {
          full_name: input.fullName,
        },
      },
    });

    if (error) {
      const message = error.message?.toLowerCase() ?? "";
      if (message.includes("already") || message.includes("exists")) {
        throw new ConflictError("An account with this email already exists");
      }
      if (error.status === 422) {
        throw new ValidationError(error.message);
      }
      console.error("[supabase-auth.signUp] unexpected error", {
        status: error.status,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Sign-up failed");
    }

    if (!data.user) {
      throw new AppError("INTERNAL_ERROR", "Sign-up returned no user");
    }

    return {
      user: toAuthUser(data.user),
      // When email confirmation is required, signUp returns user but no session.
      needsEmailConfirmation: data.session === null,
    };
  }

  async signOut(): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Don't fail the API call — signing out is best-effort. Just log.
      console.error("[supabase-auth.signOut] error", {
        status: error.status,
        message: error.message,
      });
    }
  }

  async startOAuth(input: StartOAuthInput): Promise<StartOAuthResult> {
    const supabase = await createSupabaseServerClient();
    // skipBrowserRedirect lets us return the URL to the caller (an API
    // route) instead of issuing the redirect from inside this method.
    // PKCE / state cookies are still written via our cookie wrapper.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: input.provider,
      options: {
        redirectTo: input.redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      console.error("[supabase-auth.startOAuth] error", {
        provider: input.provider,
        status: error?.status,
        message: error?.message,
      });
      throw new AppError(
        "INTERNAL_ERROR",
        "Could not start OAuth flow",
      );
    }
    return { url: data.url };
  }

  async exchangeOAuthCode(code: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[supabase-auth.exchangeOAuthCode] error", {
        status: error.status,
        message: error.message,
      });
      throw new UnauthorizedError("Could not complete sign-in");
    }
  }

  async verifyEmailOtp(input: VerifyEmailOtpInput): Promise<void> {
    const supabase = await createSupabaseServerClient();
    // Map our neutral type → Supabase's literal type.
    const { error } = await supabase.auth.verifyOtp({
      type: input.type,
      token_hash: input.tokenHash,
    });
    if (error) {
      console.error("[supabase-auth.verifyEmailOtp] error", {
        status: error.status,
        message: error.message,
        type: input.type,
      });
      throw new UnauthorizedError("Could not verify the link");
    }
  }

  async sendPasswordReset(input: SendPasswordResetInput): Promise<void> {
    const supabase = await createSupabaseServerClient();
    // Supabase's `resetPasswordForEmail` returns the same response
    // whether the email exists or not, which is the right semantic for
    // anti-leak. We do NOT log the email itself — only status/message.
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo: input.redirectTo,
    });
    if (error) {
      console.error("[supabase-auth.sendPasswordReset] error", {
        status: error.status,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Could not send password reset");
    }
  }

  async updatePassword(input: UpdatePasswordInput): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({
      password: input.password,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      console.error("[supabase-auth.updatePassword] error", {
        status: error.status,
        code,
        message: error.message,
      });
      if (error.status === 401 || error.status === 403) {
        // GoTrue refuses password updates from an aal1 session once the
        // user has a verified factor (DEV-013). Surface a stable
        // MFA_REQUIRED so the client routes to the /mfa challenge instead
        // of showing a misleading "session expired".
        const insufficientAal =
          code === "insufficient_aal" || /aal2/i.test(error.message ?? "");
        if (insufficientAal) {
          throw new MfaRequiredError();
        }
        throw new UnauthorizedError("Session expired or invalid");
      }
      if (error.status === 422) {
        // Supabase rejects a new password identical to the current one
        // (error code `same_password`). Surface a STABLE machine reason in
        // `details` so the UI can render a clear, localized message instead
        // of the raw English provider text (which otherwise reaches the
        // user unexplained).
        const isSamePassword =
          code === "same_password" ||
          /different from the old password/i.test(error.message);
        if (isSamePassword) {
          throw new ValidationError(
            "New password must be different from the current password",
            { reason: "same_password" },
          );
        }
        throw new ValidationError(error.message);
      }
      throw new AppError("INTERNAL_ERROR", "Could not update password");
    }
  }

  // ============================================================
  // MFA (TOTP) — DEV-013
  // ============================================================

  async getCurrentUserWithMfa(): Promise<CurrentUserWithMfa | null> {
    const supabase = await createSupabaseServerClient();
    // Order is load-bearing: getUser() performs the network verification
    // AND marks this client instance's session as trusted, so the local
    // getAuthenticatorAssuranceLevel() decode below is both safe and
    // warning-free. Total provider roundtrips: one (same as getCurrentUser).
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const user = toAuthUser(data.user);

    let currentLevel: AalLevel | null = null;
    const { data: aal, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) {
      // Fail CLOSED for enrolled users: an unknown level is treated as
      // "not aal2" below, so the MFA gate holds.
      console.error("[supabase-auth.getCurrentUserWithMfa] aal error", {
        message: aalError.message,
      });
    } else {
      const level = aal?.currentLevel;
      currentLevel = level === "aal1" ? "aal1" : level === "aal2" ? "aal2" : null;
    }

    return {
      user,
      currentLevel,
      // Derived from the FRESH getUser() factors (the session's cached
      // user copy can be stale across devices until token refresh).
      mfaPending: user.hasVerifiedTotp && currentLevel !== "aal2",
    };
  }

  async verifyPassword(input: VerifyPasswordInput): Promise<void> {
    // Throwaway cookie-less client: MUST NOT touch the request's session.
    // A password sign-in is aal1 — running it on the cookie client would
    // downgrade an MFA-verified (aal2) session, after which GoTrue
    // refuses the password update itself.
    const supabase = createSupabaseStatelessAuthClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) {
      if (error.status === 400) {
        throw new UnauthorizedError("Invalid email or password");
      }
      console.error("[supabase-auth.verifyPassword] unexpected error", {
        status: error.status,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Password verification failed");
    }
    // Best-effort: revoke the throwaway session we just created. Scope
    // MUST stay "local" — the default ("global") revokes EVERY session
    // of this user, including the real one making this request.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Non-fatal — the throwaway session simply expires on its own.
    }
  }

  async listTotpFactors(): Promise<TotpFactor[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      console.error("[supabase-auth.listTotpFactors] error", {
        status: error.status,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Could not list MFA factors");
    }
    return (data?.all ?? [])
      .filter((f) => f.factor_type === "totp")
      .map(
        (f): TotpFactor => ({
          id: f.id,
          friendlyName: f.friendly_name ?? null,
          status: f.status === "verified" ? "verified" : "unverified",
          createdAt: f.created_at ?? null,
        }),
      );
  }

  async enrollTotp(input: EnrollTotpInput): Promise<TotpEnrollment> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: input.issuer,
      friendlyName: input.friendlyName,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (
        code === "too_many_enrolled_mfa_factors" ||
        code === "mfa_verified_factor_exists" ||
        code === "mfa_factor_name_conflict"
      ) {
        throw new ValidationError(
          "Two-factor authentication is already set up",
          { reason: "already_enrolled" },
        );
      }
      if (code === "insufficient_aal") {
        throw new MfaRequiredError();
      }
      // Includes mfa_totp_enroll_not_enabled — a project-config problem,
      // not a user problem: loud log, generic 500 out.
      console.error("[supabase-auth.enrollTotp] error", {
        status: error.status,
        code,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Could not start MFA enrollment");
    }
    if (!data || data.type !== "totp") {
      throw new AppError("INTERNAL_ERROR", "Enrollment returned no TOTP data");
    }
    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    };
  }

  async verifyTotp(input: VerifyTotpInput): Promise<void> {
    const supabase = await createSupabaseServerClient();
    // challengeAndVerify = challenge + verify in one call. On success the
    // provider rotates the session to aal2; our cookie wrapper persists
    // the new session automatically (route-handler context).
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: input.factorId,
      code: input.code,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "mfa_factor_not_found" || error.status === 404) {
        throw new NotFoundError("Factor not found");
      }
      if (error.status === 429) {
        throw new RateLimitError();
      }
      if (
        code === "mfa_verification_failed" ||
        code === "mfa_verification_rejected" ||
        code === "mfa_challenge_expired" ||
        error.status === 400 ||
        error.status === 422
      ) {
        // A wrong/expired code is a normal user mistake — stable machine
        // reason for the UI, no error-level logging.
        throw new ValidationError("Invalid or expired code", {
          reason: "invalid_code",
        });
      }
      console.error("[supabase-auth.verifyTotp] error", {
        status: error.status,
        code,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Could not verify the code");
    }
  }

  async unenrollFactor(factorId: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "insufficient_aal") {
        // Removing a VERIFIED factor needs an aal2 session (provider rule).
        throw new MfaRequiredError();
      }
      if (code === "mfa_factor_not_found" || error.status === 404) {
        throw new NotFoundError("Factor not found");
      }
      console.error("[supabase-auth.unenrollFactor] error", {
        status: error.status,
        code,
        message: error.message,
      });
      throw new AppError("INTERNAL_ERROR", "Could not remove the factor");
    }
  }
}

// Module-level singleton. Adapter is stateless; per-request state
// (cookies) is created inside each method via createSupabaseServerClient.
export const authAdapter: AuthAdapter = new SupabaseAuthAdapter();
