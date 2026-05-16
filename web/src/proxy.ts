import { type NextRequest } from "next/server";

// The session-refresh implementation is still provider-specific
// (Supabase SSR uses its own cookie protocol). It lives in
// lib/supabase/middleware.ts and is the LAST Supabase-coupled piece
// outside the auth adapter.
//
// TODO: replace with provider-neutral session middleware during
// Firebase migration. Moving the call site here is trivial; the work
// is in re-implementing the cookie refresh in updateSession() for
// whatever new provider we use.
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt, sitemap.xml, etc.
     * - Image files
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
