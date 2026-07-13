import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";

// POST /api/auth/oauth/google
// Body: { redirect?: string }   ← optional same-origin path to land on after login
// Returns: { success: true, data: { url: string } }
//
// The client receives the URL and performs the actual browser navigation
// (window.location.assign). Cookies for PKCE/state were already written
// onto the response by the underlying auth adapter, so the subsequent
// /auth/callback request can complete the exchange.
const startOAuthSchema = z.object({
  redirect: z.string().optional(),
  // Set by the Capacitor shell so the flow returns to the app's deep link
  // (Google blocks OAuth in embedded WebViews). Absent/false on the web.
  native: z.boolean().optional(),
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const { redirect, native } = startOAuthSchema.parse(body);
  const result = await authService.startOAuth({
    provider: "google",
    redirect,
    native,
  });
  return ok(result);
});
