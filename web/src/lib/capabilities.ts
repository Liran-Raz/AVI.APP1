// Client-safe capability helpers + types.
//
// The browser uses these ONLY for display hints (show/hide controls). The
// server is always authoritative and re-checks every sensitive action — a
// capability here is never a security decision.
//
// Importing from `@/server/auth/permissions` is safe: that module is pure
// (no `server-only`, no Supabase) — just the permission catalog and types.
import type {
  Capability,
  Permission,
  RecordScope,
} from "@/server/auth/permissions";

export type { Capability, Permission, RecordScope };
export { PERMISSIONS } from "@/server/auth/permissions";

// Fail-closed capability check. Returns true ONLY when an exact matching
// grant is present in `capabilities` (optionally at a specific recordScope).
// Any malformed / missing input → false (never an implicit allow). This does
// NOT re-implement server authorization; it only reads the server-provided
// capability list.
export function hasCapability(
  capabilities: readonly Capability[] | null | undefined,
  permission: Permission,
  scope?: RecordScope,
): boolean {
  if (!Array.isArray(capabilities)) return false;
  return capabilities.some(
    (c) =>
      !!c &&
      typeof c === "object" &&
      c.permission === permission &&
      (scope === undefined || c.recordScope === scope),
  );
}
