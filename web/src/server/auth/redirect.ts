import "server-only";

// Same-origin path validator used by auth flows that take a `next` /
// `redirect` param from query string or body. Prevents open-redirect
// attacks: only paths beginning with a single "/" are accepted.

const SAFE_PATH_RE = /^\/(?!\/)[^\s]*$/;

export function sanitizeNextPath(
  value: string | null | undefined,
  fallback = "/onboarding",
): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return SAFE_PATH_RE.test(value) ? value : fallback;
}
