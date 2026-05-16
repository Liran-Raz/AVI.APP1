import { NextResponse } from "next/server";

import { sanitizeNextPath } from "@/server/auth/redirect";
import * as authService from "@/server/services/auth.service";

// GET /auth/callback?code=...&next=/some/path
//
// Backward-compatible URL: existing OAuth flows configured in the
// Supabase dashboard / Google Cloud point here. Implementation now
// goes through auth.service → auth adapter so the route handler stays
// provider-agnostic.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"), "/onboarding");

  if (code) {
    try {
      await authService.exchangeOAuthCode(code);
      return NextResponse.redirect(`${origin}${next}`);
    } catch (err) {
      // Adapter already logged the underlying provider error. Show a
      // generic message to the user and bounce back to /login.
      console.error("[auth/callback] exchange failed:", err);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
