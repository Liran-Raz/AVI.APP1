// Per-request session refresh middleware.
//
// TODO: replace with provider-neutral session middleware during Firebase
// migration. This file is the LAST piece of code that imports
// @supabase/ssr's createServerClient outside server/db/supabase.ts and
// the auth adapter. The reason it lives here (and not in the adapter)
// is that the middleware needs custom cookie handlers tied to the
// NextRequest/NextResponse pair so refreshed access/refresh tokens land
// on the outgoing response. The adapter's createSupabaseServerClient
// uses the request-scoped `cookies()` helper instead, which middleware
// can't use. When we move to Firebase Auth (or change SSR providers),
// the session-refresh strategy below must be revisited.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/server/db/database.types";

const PROTECTED_PREFIXES = [
  "/onboarding",
  "/tasks",
  "/calendar",
  "/clients",
  "/team",
  "/settings",
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // No credentials yet — let everything through so dev keeps working
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/tasks";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
