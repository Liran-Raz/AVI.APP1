import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppError, RateLimitError } from "./app-error";

// Single shape for every API response so the client can treat success/failure
// uniformly. New API routes should use ok() / fail() and wrap their handlers
// with withErrorHandler so thrown AppError / ZodError become structured 4xx
// responses instead of HTML 500 pages.

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(
  data: T,
  init?: ResponseInit,
): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(
  code: string,
  message: string,
  status = 500,
  details?: unknown,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status },
  );
}

type RouteHandler<TArgs extends unknown[]> = (
  ...args: TArgs
) => Promise<NextResponse>;

export function withErrorHandler<TArgs extends unknown[]>(
  handler: RouteHandler<TArgs>,
): RouteHandler<TArgs> {
  return async (...args: TArgs): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        // Strip zod-internal codes / regex patterns; expose only the
        // per-field user-facing message so clients can highlight inputs
        // without leaking implementation details.
        const issues = err.issues.map((i) => ({
          path: i.path,
          message: i.message,
        }));
        return fail("VALIDATION_ERROR", "Invalid input", 400, issues);
      }
      if (err instanceof RateLimitError) {
        // Uniform body (no details — no key/limit/email oracle) + Retry-After.
        const res = fail(err.code, err.message, err.status);
        res.headers.set("Retry-After", String(err.retryAfterSeconds));
        return res;
      }
      if (err instanceof AppError) {
        return fail(err.code, err.message, err.status, err.details);
      }
      // Never leak internals to the client. Log on the server, return a
      // generic message.
      console.error("[api] unhandled error:", err);
      return fail("INTERNAL_ERROR", "Something went wrong", 500);
    }
  };
}
