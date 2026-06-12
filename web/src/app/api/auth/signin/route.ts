import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import { signinSchema } from "@/server/validators/auth.schema";
import {
  clientIp,
  enforceRateLimit,
  hashEmail,
} from "@/server/security/rate-limit";

// POST /api/auth/signin
// Body: { email, password }
// Returns: { success: true, data: { userId, email, needsEmailConfirmation } }
// On failure: { success: false, error: { code, message } } (401 / 400 / 429 / 500)
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ip = clientIp(request.headers);
  // Backstop: cap total sign-in attempts from one IP.
  await enforceRateLimit("signin:ip", ip, 20, "15 m");

  const body = await request.json().catch(() => ({}));
  const input = signinSchema.parse(body);

  // Tight: throttle brute-force against a specific account, keyed by
  // IP + a hash of the normalized email (never the raw address).
  await enforceRateLimit(
    "signin:email",
    `${ip}|${hashEmail(input.email)}`,
    5,
    "15 m",
  );

  const result = await authService.signIn(input);

  // Note: the auth session cookie is set automatically by the
  // server-side Supabase client; we never expose tokens in the body.
  return ok(result);
});
