import { NextResponse } from "next/server";

import type { EmailOtpType } from "@/server/auth/auth.adapter";
import { sanitizeNextPath } from "@/server/auth/redirect";
import * as authService from "@/server/services/auth.service";

// GET /auth/confirm?...&next=/onboarding
//
// Backward-compatible URL: email links sent by Supabase (signup
// confirmation AND password recovery) point here. It accepts BOTH link
// shapes so it works regardless of the Supabase email-template style:
//   - PKCE flow (the @supabase/ssr default): the link returns with a
//     `?code=` — exchanged for a session, same as /auth/callback.
//   - OTP flow: a custom template that links directly here with
//     `token_hash` + `type` — verified via verifyOtp.
// Implementation goes through auth.service so the handler stays
// provider-agnostic.

const VALID_OTP_TYPES: ReadonlySet<EmailOtpType> = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function isValidOtpType(value: string | null): value is EmailOtpType {
  return value !== null && VALID_OTP_TYPES.has(value as EmailOtpType);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const next = sanitizeNextPath(searchParams.get("next"), "/onboarding");

  // PKCE flow (Supabase default template): the recovery/confirmation link
  // returns here with a `?code=`. Exchange it for a session, then continue
  // to `next` (e.g. /reset-password).
  if (code) {
    try {
      await authService.exchangeEmailLinkCode(code);
      return NextResponse.redirect(`${origin}${next}`);
    } catch (err) {
      console.error("[auth/confirm] code exchange failed:", err);
    }
  }

  // OTP flow (custom template): direct link here with token_hash + type.
  if (tokenHash && isValidOtpType(rawType)) {
    try {
      await authService.verifyEmailOtp({ tokenHash, type: rawType });
      return NextResponse.redirect(`${origin}${next}`);
    } catch (err) {
      console.error("[auth/confirm] verify failed:", err);
    }
  }

  // Neither flow produced a session. Safe diagnostics only (never the
  // token/code values) to reveal the link shape if this ever fires:
  // hasCode:false AND hasTokenHash:false on a click means the email
  // template delivered neither param to this server route.
  console.warn("[auth/confirm] no verified session for request", {
    hasCode: Boolean(code),
    hasTokenHash: Boolean(tokenHash),
    type: rawType,
  });

  return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
}
