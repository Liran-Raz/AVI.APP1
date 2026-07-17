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
  // True when the user has a VERIFIED TOTP factor (2FA is set up).
  // Derived from the provider's fresh user object — not from the cached
  // session copy — so cross-device enrollment shows up next request.
  hasVerifiedTotp: boolean;
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

// ============================================================
// MFA (TOTP) — DEV-013
// ============================================================

// Authenticator Assurance Level of a session. aal1 = first factor only
// (password / OAuth); aal2 = a verified second factor was presented in
// THIS session.
export type AalLevel = "aal1" | "aal2";

export type CurrentUserWithMfa = {
  user: AuthUser;
  // AAL of the current session, or null when it could not be determined.
  currentLevel: AalLevel | null;
  // True when the user is enrolled (verified TOTP factor exists) but this
  // session has NOT passed the challenge — callers must gate access until
  // verifyTotp elevates the session. Fails CLOSED: an unknown level for
  // an enrolled user counts as pending.
  mfaPending: boolean;
};

export type TotpEnrollment = {
  factorId: string;
  // Ready-to-render QR image (a data: URI produced by the provider).
  qrCode: string;
  // Manual-entry secret, shown once alongside the QR.
  secret: string;
};

export type TotpFactor = {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  createdAt: string | null;
};

export type EnrollTotpInput = {
  // Label the authenticator app shows: `issuer (account email)`.
  issuer: string;
  friendlyName: string;
};

export type VerifyTotpInput = {
  factorId: string;
  code: string;
};

export type VerifyPasswordInput = {
  email: string;
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
   * when the provider rejects the password, `MfaRequiredError` when the
   * user is MFA-enrolled but the session is only aal1 (provider-enforced).
   */
  updatePassword(input: UpdatePasswordInput): Promise<void>;

  // ============================================================
  // MFA (TOTP) — DEV-013
  // ============================================================

  /**
   * Returns the current user together with the session's MFA state in a
   * single provider roundtrip (same cost as getCurrentUser). Implementations
   * MUST derive `mfaPending` from the freshly-verified user object, not a
   * cached session copy.
   */
  getCurrentUserWithMfa(): Promise<CurrentUserWithMfa | null>;

  /**
   * Verify an email+password pair WITHOUT touching the current request's
   * session (throwaway, cookie-less client). Throws `UnauthorizedError`
   * on a wrong password. Used for re-auth checks (change password) where
   * replacing the session would downgrade aal2 → aal1.
   */
  verifyPassword(input: VerifyPasswordInput): Promise<void>;

  /** Lists the current user's TOTP factors — verified AND unverified. */
  listTotpFactors(): Promise<TotpFactor[]>;

  /**
   * Starts TOTP enrollment; the factor stays "unverified" until
   * verifyTotp succeeds with a code from the authenticator app.
   */
  enrollTotp(input: EnrollTotpInput): Promise<TotpEnrollment>;

  /**
   * Challenge-and-verify a TOTP factor with a 6-digit code. On success
   * the provider rotates the session to aal2 (cookies update when called
   * from a route handler). Throws `ValidationError` with
   * `{ reason: "invalid_code" }` on a wrong/expired code.
   */
  verifyTotp(input: VerifyTotpInput): Promise<void>;

  /**
   * Removes a factor. Removing a VERIFIED factor requires an aal2
   * session (provider-enforced → `MfaRequiredError`); unverified factors
   * can be removed at aal1 (abandoned-enrollment cleanup).
   */
  unenrollFactor(factorId: string): Promise<void>;
}
