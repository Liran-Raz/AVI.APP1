// Same-origin path validator for auth flows that accept a `next` / `redirect`
// param from the query string or a request body. Prevents open-redirect
// attacks: only a single-leading-slash same-origin path is accepted.
//
// Pure + client-safe (NO "server-only") on purpose — the server auth flows and
// the client login form share ONE hardened implementation, so neither can drift.
//
// Rejects the two origin-escape tricks that survive browser URL normalization:
//   "//evil.com"  → protocol-relative (blocked by the (?!\/) lookahead)
//   "/\evil.com"  → browsers normalize "\"→"/" → protocol-relative (blocked by
//                   excluding backslash from the path body)
const SAFE_PATH_RE = /^\/(?!\/)[^\s\\]*$/;

export function sanitizeNextPath(
  value: string | null | undefined,
  fallback = "/onboarding",
): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return SAFE_PATH_RE.test(value) ? value : fallback;
}
