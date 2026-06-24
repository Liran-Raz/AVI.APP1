import "server-only";

// Authoritative authorization engine. SERVER-ONLY — the browser must never
// import this; UI capabilities are display hints resolved from /api/me.
//
// Contract:
//   - can(session, permission, ctx?)        → boolean (never throws)
//   - requirePermission(session, perm, ctx?) → void   (throws ForbiddenError)
//   - resolveCapabilities(session)           → Capability[] (for /api/me)
//   - canPerformProtectedAction(session, a)  → boolean (ownership.transfer)
//
// Fail-closed everywhere: no grant = deny; missing/invalid context = deny;
// cross-org context = deny; unsupported scope (assigned/team) = deny.
//
// PHASE 1 IS INERT: nothing here is wired into routes/services/UI yet.

import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/domain.types";
import { ForbiddenError } from "@/server/errors/app-error";
import {
  PERMISSION_META,
  PERMISSIONS,
  PROTECTED_ACTIONS,
  SUPPORTED_RECORD_SCOPES,
  type Capability,
  type ClientContext,
  type ContactContext,
  type ContextFor,
  type ContextKind,
  type Permission,
  type ProtectedAction,
  type RecordScope,
  type TaskAssignmentContext,
  type TaskContext,
  type TeamMemberContext,
} from "./permissions";
import { ROLE_GRANTS, type Grant, type GrantMap } from "./permission-grants";

// Variadic context argument: required for context-sensitive permissions,
// forbidden for contextless ones (compile-time enforcement).
type ContextArgs<P extends Permission> = ContextFor<P> extends undefined
  ? []
  : [context: ContextFor<P>];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Validate the trusted context for a permission and apply org/target checks.
// Returns true only if the context is structurally valid AND passes the
// tenant / target gate. For assignment permissions this also encodes the
// self-vs-others decision.
function checkContext(
  session: FullSession,
  permission: Permission,
  kind: ContextKind,
  context: unknown,
): boolean {
  const activeOrg = session.activeOrg.id;

  switch (kind) {
    case "none":
      return true;

    case "client": {
      const c = context as Partial<ClientContext>;
      if (!isNonEmptyString(c.orgId)) return false; // fail-closed
      if (!("ownerId" in (c as object))) return false; // ownerId must be provided (null allowed)
      return c.orgId === activeOrg; // cross-org = deny
    }

    case "contact": {
      const c = context as Partial<ContactContext>;
      if (!c.parentClient) return false;
      return checkContext(session, permission, "client", c.parentClient);
    }

    case "task": {
      const t = context as Partial<TaskContext>;
      if (!isNonEmptyString(t.orgId)) return false;
      if (!isNonEmptyString(t.creatorId)) return false;
      if (!("assigneeId" in (t as object))) return false;
      return t.orgId === activeOrg;
    }

    case "task_assignment": {
      const t = context as Partial<TaskAssignmentContext>;
      if (!isNonEmptyString(t.orgId)) return false;
      if (t.orgId !== activeOrg) return false; // task must be in the active org
      if (!isNonEmptyString(t.targetAssigneeId)) return false;
      if (!isNonEmptyString(t.targetAssigneeOrgId)) return false;
      if (typeof t.targetAssigneeActive !== "boolean") return false;
      if (!t.targetAssigneeActive) return false; // inactive target = deny
      if (t.targetAssigneeOrgId !== activeOrg) return false; // cross-org target = deny
      if (permission === PERMISSIONS.TASKS_ASSIGN_SELF) {
        // may only target self
        return t.targetAssigneeId === session.profile.id;
      }
      // tasks.assign_others: any active member of the active org (incl. self)
      return true;
    }

    case "team_member": {
      const m = context as Partial<TeamMemberContext>;
      if (!isNonEmptyString(m.targetUserId)) return false;
      if (!isNonEmptyString(m.targetMembershipOrgId)) return false;
      if (!isNonEmptyString(m.targetRole)) return false;
      return m.targetMembershipOrgId === activeOrg; // cross-org = deny
    }

    default:
      return false;
  }
}

function resolveOwnerId(kind: ContextKind, context: unknown): string | null {
  switch (kind) {
    case "client":
      return (context as ClientContext).ownerId;
    case "contact":
      return (context as ContactContext).parentClient.ownerId;
    case "task":
      return (context as TaskContext).creatorId;
    default:
      return null;
  }
}

function evaluateScope(
  session: FullSession,
  kind: ContextKind,
  scope: RecordScope,
  context: unknown,
): boolean {
  if (!SUPPORTED_RECORD_SCOPES.includes(scope)) return false; // assigned/team = deny (no model)
  if (scope === "all") return true; // org already validated in checkContext
  if (scope === "own") {
    const ownerId = resolveOwnerId(kind, context);
    if (ownerId == null) return false; // fail-closed
    return ownerId === session.profile.id;
  }
  return false;
}

// Core decision. Plain (untyped-context) so both can() and requirePermission()
// share one implementation; the public wrappers add the typed-context surface.
function evaluate(
  grants: Record<UserRole, GrantMap>,
  session: FullSession,
  permission: Permission,
  context: unknown,
): boolean {
  // CUTOVER seam: when the session carries a DB-resolved grant map (cutover
  // flag ON), it is authoritative; otherwise fall back to the in-code map keyed
  // by the active role — byte-for-byte today's behavior. See db-role-resolver
  // DB_ROLE_AUTHORITATIVE.
  const roleGrants = session.grantMap ?? grants[session.activeRole];
  if (!roleGrants) return false;
  const grant: Grant | undefined = roleGrants[permission];
  if (grant === undefined) return false; // no grant = deny

  const meta = PERMISSION_META[permission];
  if (meta === undefined) return false; // unknown permission = deny

  if (meta.context !== "none") {
    if (context === undefined || context === null) return false; // fail-closed
    if (!checkContext(session, permission, meta.context, context)) return false;
  }

  if (meta.scoped) {
    if (grant === true) return false; // a scoped permission must carry a RecordScope grant
    return evaluateScope(session, meta.context, grant, context);
  }

  return true;
}

export type Authorizer = {
  can: <P extends Permission>(
    session: FullSession,
    permission: P,
    ...args: ContextArgs<P>
  ) => boolean;
  requirePermission: <P extends Permission>(
    session: FullSession,
    permission: P,
    ...args: ContextArgs<P>
  ) => void;
  // Coarse capability gate: does the active role have ANY grant for this
  // permission (ignoring scope/context)? Use as a pre-load check before the
  // record is fetched, so a forbidden caller is rejected without revealing
  // whether the target record exists. The full requirePermission(perm, ctx)
  // still runs after the trusted record is loaded.
  requireCapability: (session: FullSession, permission: Permission) => void;
  // Collection (list) authorization for a record-scoped permission. Returns
  // the granted record scope (which shapes the query). Throws ForbiddenError
  // when there is no grant OR the granted scope is unsupported (assigned/team)
  // — fail-closed; we never list "everything" for a scope we cannot enforce.
  resolveListScope: (
    session: FullSession,
    permission: Permission,
  ) => RecordScope;
  resolveCapabilities: (session: FullSession) => Capability[];
};

// Factory — enables dependency injection of an alternate grant map in tests
// (e.g. to exercise own/assigned/team scope handling).
export function makeAuthorizer(grants: Record<UserRole, GrantMap>): Authorizer {
  function can<P extends Permission>(
    session: FullSession,
    permission: P,
    ...args: ContextArgs<P>
  ): boolean {
    return evaluate(grants, session, permission, (args as unknown[])[0]);
  }

  function requirePermission<P extends Permission>(
    session: FullSession,
    permission: P,
    ...args: ContextArgs<P>
  ): void {
    if (!evaluate(grants, session, permission, (args as unknown[])[0])) {
      // Generic, client-safe error — never leaks the permission/scope/role.
      throw new ForbiddenError();
    }
  }

  function requireCapability(
    session: FullSession,
    permission: Permission,
  ): void {
    const grant = (session.grantMap ?? grants[session.activeRole])?.[permission];
    if (grant === undefined) throw new ForbiddenError();
  }

  function resolveListScope(
    session: FullSession,
    permission: Permission,
  ): RecordScope {
    const grant = (session.grantMap ?? grants[session.activeRole])?.[permission];
    if (grant === undefined) throw new ForbiddenError(); // no grant = deny
    const scope: RecordScope = grant === true ? "all" : grant;
    if (!SUPPORTED_RECORD_SCOPES.includes(scope)) {
      throw new ForbiddenError(); // unsupported scope (assigned/team) = fail closed
    }
    return scope;
  }

  function resolveCapabilities(session: FullSession): Capability[] {
    const roleGrants = session.grantMap ?? grants[session.activeRole] ?? {};
    const caps: Capability[] = [];
    for (const key of Object.keys(roleGrants) as Permission[]) {
      const grant = roleGrants[key];
      if (grant === undefined) continue;
      caps.push(
        grant === true
          ? { permission: key }
          : { permission: key, recordScope: grant },
      );
    }
    return caps;
  }

  return {
    can,
    requirePermission,
    requireCapability,
    resolveListScope,
    resolveCapabilities,
  };
}

// ============================================================
// Default authorizer (bound to ROLE_GRANTS)
// ============================================================

const defaultAuthorizer = makeAuthorizer(ROLE_GRANTS);

export const can = defaultAuthorizer.can;
export const requirePermission = defaultAuthorizer.requirePermission;
export const requireCapability = defaultAuthorizer.requireCapability;
export const resolveListScope = defaultAuthorizer.resolveListScope;
export const resolveCapabilities = defaultAuthorizer.resolveCapabilities;

// ============================================================
// Protected (non-grantable) system actions
// ============================================================

// `ownership.transfer` (and any future protected action) is owner-only and is
// NEVER derived from the grant map. Enforced separately so a custom role can
// never receive owner authority.
export function canPerformProtectedAction(
  session: FullSession,
  action: ProtectedAction,
): boolean {
  if (action === PROTECTED_ACTIONS.OWNERSHIP_TRANSFER) {
    return session.activeRole === "owner";
  }
  return false;
}

// True only for keys that are real, grantable permissions. `ownership.transfer`
// is NOT grantable, so this returns false for it.
export function isGrantablePermission(value: string): value is Permission {
  return (Object.values(PERMISSIONS) as string[]).includes(value);
}

// ============================================================
// Safe authorization log metadata (separate from email metadata)
// ============================================================
//
// Client-facing failures use a generic ForbiddenError (no internals). For
// server-side security monitoring, emit ONLY these stable fields. It carries
// the permission + actor role + org id (internal monitoring signal) but NEVER
// PII, tokens, record contents, or arbitrary error strings.

export type AuthzLogMeta = {
  category: "authz_allowed" | "authz_denied";
  permission: Permission;
  actorRole: UserRole;
  orgId: string;
};

export function authzLogMeta(
  session: FullSession,
  permission: Permission,
  allowed: boolean,
): AuthzLogMeta {
  return {
    category: allowed ? "authz_allowed" : "authz_denied",
    permission,
    actorRole: session.activeRole,
    orgId: session.activeOrg.id,
  };
}
