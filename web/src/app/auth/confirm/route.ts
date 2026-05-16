import { NextResponse } from "next/server";

import type { EmailOtpType } from "@/server/auth/auth.adapter";
import { sanitizeNextPath } from "@/server/auth/redirect";
import * as authService from "@/server/services/auth.service";

// GET /auth/confirm?token_hash=...&type=signup&next=/onboarding
//
// Backward-compatible URL: existing email links sent by Supabase point
// here. Implementation now goes through auth.service so the route
// handler stays provider-agnostic.

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
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const next = sanitizeNextPath(searchParams.get("next"), "/onboarding");

  if (tokenHash && isValidOtpType(rawType)) {
    try {
      await authService.verifyEmailOtp({ tokenHash, type: rawType });
      return NextResponse.redirect(`${origin}${next}`);
    } catch (err) {
      console.error("[auth/confirm] verify failed:", err);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
}
