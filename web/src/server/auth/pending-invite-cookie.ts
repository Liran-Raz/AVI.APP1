import "server-only";
import { cookies } from "next/headers";

import { env } from "@/server/env";

// Short-lived carrier for the raw invite token across the email-confirmation
// round-trip.
//
// Why this exists: an invited user signs up via /invite/signup; the
// post-confirmation `next=/invite/accept?token=...` is carried in the
// Supabase confirmation email's redirect, but that nested query does NOT
// survive Supabase's email -> verify -> redirect round-trip, so the confirmed
// (office-less) user is funneled to /onboarding instead of the accept page.
// This cookie lets the /onboarding choke point recover the token and route
// the user to acceptance instead of showing the create-office form.
//
// Trust model: the raw token IS the bearer secret and is already in the link
// the user holds; storing it httpOnly + short-lived for the same browser is
// no weaker than that link. Never logged. Cleared once the invite is accepted.
//
// Reading works in any server context; writing/clearing only in Route
// Handlers (Next.js restriction). Mirrors active-org-cookie.ts style.

export const PENDING_INVITE_COOKIE = "avi.pendingInvite";

const MAX_AGE_SECONDS = 60 * 60; // 1 hour — enough to check email + confirm

export async function readPendingInviteCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(PENDING_INVITE_COOKIE)?.value ?? null;
}

export async function writePendingInviteCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(PENDING_INVITE_COOKIE, token, {
    httpOnly: true,
    // localhost dev server is plain http; only force Secure in prod.
    secure: env.NODE_ENV === "production",
    // Lax so the cookie is sent on the top-level navigation back from the
    // email-confirmation link.
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearPendingInviteCookie(): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_INVITE_COOKIE);
}
