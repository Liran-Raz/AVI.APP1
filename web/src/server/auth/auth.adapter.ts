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

export interface AuthAdapter {
  /**
   * Returns the authenticated user for the current request, or null if
   * the request has no valid session.
   *
   * Implementations MUST read from a trusted source (cookies + server
   * verification) — do not trust client-provided JWTs.
   */
  getCurrentUser(): Promise<AuthUser | null>;
}
