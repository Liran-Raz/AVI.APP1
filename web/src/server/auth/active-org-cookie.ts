import "server-only";
import { cookies } from "next/headers";

import { env } from "@/server/env";

// Active-office context cookie.
//
// Stores the UUID of the org the user is currently "in". It is a
// CONVENIENCE pointer only — never a trust boundary. Every request
// re-validates that the user actually has an ACTIVE membership in this
// org against the DB (see session.ts), and RLS is the second line of
// defense. A tampered cookie cannot widen access: it can only point at
// an org, and a non-member's pointer is ignored (falls back to the first
// active membership).
//
// Reading works in any server context. Writing/clearing only works in
// Route Handlers / Server Actions (Next.js restriction) — never call the
// writers from a Server Component render.

export const ACTIVE_ORG_COOKIE = "avi.activeOrg";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function readActiveOrgCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_ORG_COOKIE)?.value ?? null;
}

export async function writeActiveOrgCookie(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    // localhost is a secure context, but the dev server is plain http and
    // some tools drop Secure cookies there — only force Secure in prod.
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearActiveOrgCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_ORG_COOKIE);
}
