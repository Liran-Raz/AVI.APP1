import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import {
  AppError,
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors/app-error";
import type {
  AuthAdapter,
  AuthUser,
  SignInInput,
  SignUpInput,
  SignUpResult,
  StartOAuthInput,
  StartOAuthResult,
  VerifyEmailOtpInput,
} from "./auth.adapter";

// Supabase implementation of AuthAdapter.
// Only this file imports @supabase/* for auth purposes. Replace this
// module to swap providers (e.g. Firebase Auth) without touching the
// rest of the codebase.

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function toAuthUser(u: SupabaseAuthUser): AuthUser {
  return {
    id: u.id,
    email: u.email ?? null,
    emailConfirmedAt: u.email_confirmed_at ?? null,
    metadata: u.user_metadata ?? {},
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
}

// Module-level singleton. Adapter is stateless; per-request state
// (cookies) is created inside each method via createSupabaseServerClient.
export const authAdapter: AuthAdapter = new SupabaseAuthAdapter();
