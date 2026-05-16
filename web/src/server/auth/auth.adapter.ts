import "server-only";

// Framework- and provider-agnostic auth contract.
// The rest of the codebase depends on THIS interface — not on Supabase.
// When we migrate to Firebase Auth (or anything else), we swap the
// implementation behind this interface.

export interface AuthUser {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
  // Provider-specific metadata kept opaque on purpose: the app should not
  // depend on its shape. Use it only where you also own the writes.
  metadata: Record<string, unknown>;
}

export type SignInInput = {
  email: string;
  password: string;
};

export type SignUpInput = {
  email: string;
  password: string;
  fullName: string;
  // Where the email-confirmation link should send the user back to.
  emailRedirectTo?: string;
};

export type SignUpResult = {
  user: AuthUser;
  needsEmailConfirmation: boolean;
};

export interface AuthAdapter {
  /**
   * Returns the authenticated user for the current request, or null if
   * the request has no valid session.
   *
   * Implementations MUST read from a trusted source (cookies + server
   * verification) — do not trust client-provided JWTs.
   */
  getCurrentUser(): Promise<AuthUser | null>;

  /**
   * Sign in with email/password. Returns the AuthUser on success.
   * Implementations MUST throw `UnauthorizedError` on bad credentials —
   * never leak whether the email exists vs the password was wrong.
   */
  signIn(input: SignInInput): Promise<AuthUser>;

  /**
   * Create a new auth user. If the provider requires email confirmation,
   * `needsEmailConfirmation` will be true and no active session exists yet.
   */
  signUp(input: SignUpInput): Promise<SignUpResult>;

  /**
   * Invalidate the current session cookie. No-op when already signed out.
   */
  signOut(): Promise<void>;
}
