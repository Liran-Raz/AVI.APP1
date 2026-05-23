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

// OAuth — provider list intentionally narrow until we actually add more.
export type OAuthProvider = "google";

export type StartOAuthInput = {
  provider: OAuthProvider;
  // Absolute URL the provider should redirect back to after the user
  // authenticates. The route at this URL is responsible for finishing
  // the code-for-session exchange via exchangeOAuthCode().
  redirectTo: string;
};

export type StartOAuthResult = {
  // The URL the browser must navigate to in order to start the flow.
  url: string;
};

// Email OTP types we accept on the verification route. Mirrors the
// Supabase vocabulary today; when we migrate, this enum stays and the
// adapter maps to whatever the new provider expects.
export type EmailOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email";

export type VerifyEmailOtpInput = {
  tokenHash: string;
  type: EmailOtpType;
};

// Password reset — kicks off the email-based recovery flow. The
// provider sends an email containing a link that hits our /auth/confirm
// route with `type=recovery` and the `next` we pass through redirectTo.
export type SendPasswordResetInput = {
  email: string;
  // Absolute URL the recovery link should redirect to after the OTP
  // is verified. Typically `${SITE_URL}/auth/confirm?next=/reset-password`.
  redirectTo: string;
};

// Update password — uses the active session (set by clicking a recovery
// link). No identifier needed because the provider knows who is signed in.
export type UpdatePasswordInput = {
  password: string;
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

  /**
   * Begin an OAuth flow. The implementation generates any state / PKCE
   * material and stores it via the request's cookie store, then returns
   * the URL the browser should navigate to. The caller is responsible
   * for performing the actual navigation (Next.js redirect or window.location).
   */
  startOAuth(input: StartOAuthInput): Promise<StartOAuthResult>;

  /**
   * Finish an OAuth flow: take the `code` returned by the provider,
   * exchange it for a session, and persist the session via cookies.
   * Throws AppError on failure.
   */
  exchangeOAuthCode(code: string): Promise<void>;

  /**
   * Verify an email-link OTP. On success, the resulting session is
   * persisted via cookies. Throws AppError on failure.
   */
  verifyEmailOtp(input: VerifyEmailOtpInput): Promise<void>;

  /**
   * Trigger a password-reset email. Implementations SHOULD NOT throw
   * on "user not found" — that distinction must not leak to the client.
   * They MAY throw on real provider errors (network, misconfiguration);
   * the service is expected to swallow those for the same anti-leak
   * reason and log server-side.
   */
  sendPasswordReset(input: SendPasswordResetInput): Promise<void>;

  /**
   * Update the password of the currently authenticated user. Relies on
   * the active session set by `verifyEmailOtp({ type: "recovery" })`.
   * Throws `UnauthorizedError` when no session exists, `ValidationError`
   * when the provider rejects the password.
   */
  updatePassword(input: UpdatePasswordInput): Promise<void>;
}
