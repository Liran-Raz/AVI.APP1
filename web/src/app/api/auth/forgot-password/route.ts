import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import { forgotPasswordSchema } from "@/server/validators/auth.schema";
import {
  clientIp,
  enforceRateLimit,
  hashEmail,
} from "@/server/security/rate-limit";

// POST /api/auth/forgot-password
// Body: { email }
// Returns: { success: true, data: null }
//
// Anti-leak: always returns success regardless of whether the email
// belongs to a real user. The service swallows provider errors and
// logs them server-side; clients cannot tell the difference. This
// matches the safe-by-default behavior of Supabase Auth itself.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ip = clientIp(request.headers);
  // Backstop: cap reset requests per IP.
  await enforceRateLimit("forgot:ip", ip, 10, "1 h");

  const body = await request.json().catch(() => ({}));
  const input = forgotPasswordSchema.parse(body);

  // Tight: throttle email-bombing of a specific address (IP + email hash).
  // The 429 is uniform and does not reveal whether the email exists —
  // anti-enumeration is preserved.
  await enforceRateLimit(
    "forgot:email",
    `${ip}|${hashEmail(input.email)}`,
    3,
    "1 h",
  );

  await authService.requestPasswordReset(input);
  return ok(null);
});
