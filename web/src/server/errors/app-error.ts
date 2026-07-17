// Domain error hierarchy. All app-level failures should extend AppError
// so the API boundary can translate them into consistent HTTP responses.
//
// Intentionally framework-free: these classes are safe to import from
// service / repository code without dragging Next.js types along.

export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "MFA_REQUIRED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    status = 500,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Not authenticated") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not allowed") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

// 401 with a distinguishable code: the session is authenticated (aal1) but
// the user has a verified second factor, so access is denied until the TOTP
// challenge is passed (POST /api/auth/mfa/verify). Clients route to /mfa on
// this code instead of treating it like a plain "not signed in".
export class MfaRequiredError extends AppError {
  constructor(message = "Multi-factor authentication required") {
    super("MFA_REQUIRED", message, 401);
    this.name = "MfaRequiredError";
  }
}

// 429. Message is intentionally generic and uniform — it must never reveal
// the key, the limit internals, or whether an email/account exists. The
// retry hint travels in a Retry-After header (set by withErrorHandler),
// not in the response body.
export class RateLimitError extends AppError {
  public readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60) {
    super("RATE_LIMITED", "Too many requests. Please try again later.", 429);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
