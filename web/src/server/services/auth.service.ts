import "server-only";

import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import { env } from "@/server/env";

// Auth service — the only consumer of AuthAdapter for sign-in/up/out.
// API routes call these functions; they never touch the adapter or
// the supabase client directly.
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
  const result = await authAdapter.signUp({
    email: input.email,
    password: input.password,
    fullName: input.fullName,
    // After clicking the confirmation email, users land on /onboarding,
    // which redirects to /tasks once a profile exists.
    emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/onboarding`,
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
