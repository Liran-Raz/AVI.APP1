// Server-side re-export of the shared, hardened same-origin path validator.
// The implementation lives in the client-safe `@/lib/safe-path` so the server
// auth flows AND the client login form use ONE source of truth (no drift).
// Existing server callers keep importing `sanitizeNextPath` from here unchanged.
export { sanitizeNextPath } from "@/lib/safe-path";
