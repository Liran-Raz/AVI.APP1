import { describe, expect, it } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/domain.types";
import { ForbiddenError } from "@/server/errors/app-error";
import { PERMISSIONS, PROTECTED_ACTIONS } from "./permissions";
import { ROLE_GRANTS, type GrantMap } from "./permission-grants";
import {
  authzLogMeta,
  can,
  canPerformProtectedAction,
  isGrantablePermission,
  makeAuthorizer,
  requireCapability,
  requirePermission,
  resolveListScope,
  resolveCapabilities,
} from "./authorization";

const ORG = "org-1";
const SELF = "user-self";
const OTHER = "user-other";

function session(
  role: UserRole,
  opts: { userId?: string; orgId?: string } = {},
): FullSession {
  const userId = opts.userId ?? SELF;
  const orgId = opts.orgId ?? ORG;
  return {
    user: { id: userId, email: "self@example.test" },
    profile: {
      id: userId,
      org_id: orgId,
      role,
      is_active: true,
      full_name: "Self",
      email: "self@example.test",
    },
    organization: { id: orgId, name: "Org", org_code: "ORG1" },
    activeOrg: { id: orgId, name: "Org", org_code: "ORG1" },
    activeRole: role,
    memberships: [],
  } as unknown as FullSession;
}

// Loosely-typed handle to exercise runtime fail-closed paths that the typed
// surface forbids at compile time (missing context, unknown permission).
const canLoose = can as unknown as (
  s: FullSession,
  p: string,
  c?: unknown,
) => boolean;

const owner = session("owner");
const manager = session("admin"); // internal key `admin` = Manager
const employee = session("employee");

const clientCtx = { orgId: ORG, ownerId: null };
const contactCtx = { parentClient: { orgId: ORG, ownerId: null } };

describe("default grants — Owner", () => {
  it("allows contextless owner-only capability (organization.settings)", () => {
    expect(can(owner, PERMISSIONS.ORGANIZATION_SETTINGS)).toBe(true);
  });
  it("allows record-scoped action (clients.archive @ all)", () => {
    expect(can(owner, PERMISSIONS.CLIENTS_ARCHIVE, clientCtx)).toBe(true);
  });
  it("allows contacts.delete", () => {
    expect(can(owner, PERMISSIONS.CONTACTS_DELETE, contactCtx)).toBe(true);
  });
});

describe("default grants — Manager (admin)", () => {
  it("allows contacts.delete", () => {
    expect(can(manager, PERMISSIONS.CONTACTS_DELETE, contactCtx)).toBe(true);
  });
  it("allows team.invite", () => {
    expect(can(manager, PERMISSIONS.TEAM_INVITE)).toBe(true);
  });
  it("denies organization.settings (owner-only)", () => {
    expect(can(manager, PERMISSIONS.ORGANIZATION_SETTINGS)).toBe(false);
  });
});

describe("default grants — Employee", () => {
  it("allows clients.view (Phase 1 sees all clients)", () => {
    expect(can(employee, PERMISSIONS.CLIENTS_VIEW, clientCtx)).toBe(true);
  });
  it("DENIES contacts.delete", () => {
    expect(can(employee, PERMISSIONS.CONTACTS_DELETE, contactCtx)).toBe(false);
  });
  it("denies team.invite", () => {
    expect(can(employee, PERMISSIONS.TEAM_INVITE)).toBe(false);
  });
});

describe("fail-closed behavior", () => {
  it("missing grant = deny", () => {
    expect(can(employee, PERMISSIONS.ORGANIZATION_SETTINGS)).toBe(false);
  });
  it("unknown permission = deny", () => {
    expect(canLoose(owner, "bogus.permission")).toBe(false);
  });
  it("missing context on a context-required permission = deny", () => {
    expect(canLoose(owner, PERMISSIONS.CLIENTS_VIEW)).toBe(false);
  });
  it("invalid context (missing orgId) = deny", () => {
    expect(canLoose(owner, PERMISSIONS.CLIENTS_VIEW, {})).toBe(false);
  });
  it("invalid context (missing ownerId field) = deny", () => {
    expect(canLoose(owner, PERMISSIONS.CLIENTS_VIEW, { orgId: ORG })).toBe(
      false,
    );
  });
  it("cross-org context = deny", () => {
    expect(
      can(owner, PERMISSIONS.CLIENTS_VIEW, { orgId: "org-OTHER", ownerId: null }),
    ).toBe(false);
  });
});

describe("contact authorization inherits the parent client", () => {
  it("allows when parent client is in the active org", () => {
    expect(can(owner, PERMISSIONS.CONTACTS_DELETE, contactCtx)).toBe(true);
  });
  it("denies when parent client is cross-org", () => {
    expect(
      can(owner, PERMISSIONS.CONTACTS_DELETE, {
        parentClient: { orgId: "org-OTHER", ownerId: null },
      }),
    ).toBe(false);
  });
  it("denies when parent client context is missing", () => {
    expect(canLoose(owner, PERMISSIONS.CONTACTS_DELETE, {})).toBe(false);
  });
});

describe("task assignment — separate self/others permissions", () => {
  const base = {
    orgId: ORG,
    targetAssigneeActive: true,
    targetAssigneeOrgId: ORG,
  };
  it("assign_self allows targeting self", () => {
    expect(
      can(employee, PERMISSIONS.TASKS_ASSIGN_SELF, {
        ...base,
        targetAssigneeId: SELF,
      }),
    ).toBe(true);
  });
  it("assign_self denies targeting another user", () => {
    expect(
      can(employee, PERMISSIONS.TASKS_ASSIGN_SELF, {
        ...base,
        targetAssigneeId: OTHER,
      }),
    ).toBe(false);
  });
  it("assign_others allows targeting another active member", () => {
    expect(
      can(manager, PERMISSIONS.TASKS_ASSIGN_OTHERS, {
        ...base,
        targetAssigneeId: OTHER,
      }),
    ).toBe(true);
  });
  it("assign_others denies an inactive target", () => {
    expect(
      can(manager, PERMISSIONS.TASKS_ASSIGN_OTHERS, {
        ...base,
        targetAssigneeActive: false,
        targetAssigneeId: OTHER,
      }),
    ).toBe(false);
  });
  it("assign_others denies a cross-org target", () => {
    expect(
      can(manager, PERMISSIONS.TASKS_ASSIGN_OTHERS, {
        ...base,
        targetAssigneeOrgId: "org-OTHER",
        targetAssigneeId: OTHER,
      }),
    ).toBe(false);
  });
});

describe("record scopes (own supported; assigned/team unsupported = deny)", () => {
  const scoped = makeAuthorizer({
    owner: { "clients.view": "own" } as GrantMap,
    admin: { "clients.view": "assigned" } as GrantMap,
    employee: { "clients.view": "team" } as GrantMap,
  });

  it("own = allow when the actor owns the record", () => {
    expect(
      scoped.can(session("owner", { userId: SELF }), PERMISSIONS.CLIENTS_VIEW, {
        orgId: ORG,
        ownerId: SELF,
      }),
    ).toBe(true);
  });
  it("own = deny when the actor does not own the record", () => {
    expect(
      scoped.can(session("owner", { userId: SELF }), PERMISSIONS.CLIENTS_VIEW, {
        orgId: ORG,
        ownerId: OTHER,
      }),
    ).toBe(false);
  });
  it("assigned = deny (no assignment model yet)", () => {
    expect(
      scoped.can(session("admin"), PERMISSIONS.CLIENTS_VIEW, {
        orgId: ORG,
        ownerId: SELF,
      }),
    ).toBe(false);
  });
  it("team = deny (no teams model yet)", () => {
    expect(
      scoped.can(session("employee"), PERMISSIONS.CLIENTS_VIEW, {
        orgId: ORG,
        ownerId: SELF,
      }),
    ).toBe(false);
  });
});

describe("protected ownership action (non-grantable)", () => {
  it("ownership.transfer is not a grantable permission", () => {
    expect(isGrantablePermission(PROTECTED_ACTIONS.OWNERSHIP_TRANSFER)).toBe(
      false,
    );
  });
  it("only an active owner may transfer ownership", () => {
    expect(
      canPerformProtectedAction(owner, PROTECTED_ACTIONS.OWNERSHIP_TRANSFER),
    ).toBe(true);
    expect(
      canPerformProtectedAction(manager, PROTECTED_ACTIONS.OWNERSHIP_TRANSFER),
    ).toBe(false);
    expect(
      canPerformProtectedAction(employee, PROTECTED_ACTIONS.OWNERSHIP_TRANSFER),
    ).toBe(false);
  });
});

describe("requirePermission — safe client error", () => {
  it("throws a generic ForbiddenError that leaks no internals", () => {
    let thrown: unknown;
    try {
      requirePermission(employee, PERMISSIONS.CONTACTS_DELETE, contactCtx);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ForbiddenError);
    const err = thrown as ForbiddenError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.status).toBe(403);
    expect(err.message).not.toContain("contacts.delete");
    expect(err.message).not.toContain("employee");
  });
  it("does not throw when allowed", () => {
    expect(() =>
      requirePermission(owner, PERMISSIONS.ORGANIZATION_VIEW),
    ).not.toThrow();
  });
});

describe("safe internal authorization log metadata", () => {
  it("contains only stable fields and no PII", () => {
    const meta = authzLogMeta(employee, PERMISSIONS.CONTACTS_DELETE, false);
    expect(meta).toEqual({
      category: "authz_denied",
      permission: "contacts.delete",
      actorRole: "employee",
      orgId: ORG,
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("@example.test"); // no email
    expect(serialized).not.toContain("Self"); // no name
  });
});

describe("capabilities include scope and exclude protected actions", () => {
  it("owner capabilities carry recordScope for scoped permissions", () => {
    const caps = resolveCapabilities(owner);
    expect(caps).toContainEqual({
      permission: "clients.view",
      recordScope: "all",
    });
    expect(caps).toContainEqual({ permission: "organization.view" });
  });
  it("never exposes ownership.transfer as a capability", () => {
    for (const role of ["owner", "admin", "employee"] as const) {
      const caps = resolveCapabilities(session(role));
      expect(
        caps.some(
          (c) =>
            (c.permission as string) ===
            PROTECTED_ACTIONS.OWNERSHIP_TRANSFER,
        ),
      ).toBe(false);
    }
  });
  it("returns no usable capabilities for an office-less session (no active role)", () => {
    const officeless = {
      ...session("employee"),
      activeRole: null,
    } as unknown as FullSession;
    expect(resolveCapabilities(officeless)).toEqual([]);
  });
});

describe("compatibility with current role keys", () => {
  it("admin role key resolves as Manager", () => {
    expect(can(session("admin"), PERMISSIONS.TEAM_INVITE)).toBe(true);
    expect(ROLE_GRANTS.admin["team.invite"]).toBe(true);
  });
});

describe("requireCapability — coarse pre-load gate", () => {
  it("allows a role that holds the grant (owner: clients.archive)", () => {
    expect(() =>
      requireCapability(owner, PERMISSIONS.CLIENTS_ARCHIVE),
    ).not.toThrow();
  });
  it("denies a role without the grant (employee: clients.archive)", () => {
    expect(() =>
      requireCapability(employee, PERMISSIONS.CLIENTS_ARCHIVE),
    ).toThrow(ForbiddenError);
  });
  it("denies contacts.delete for employee (Owner/Manager only)", () => {
    expect(() =>
      requireCapability(employee, PERMISSIONS.CONTACTS_DELETE),
    ).toThrow(ForbiddenError);
    expect(() =>
      requireCapability(owner, PERMISSIONS.CONTACTS_DELETE),
    ).not.toThrow();
    expect(() =>
      requireCapability(manager, PERMISSIONS.CONTACTS_DELETE),
    ).not.toThrow();
  });
});

describe("resolveListScope — collection authorization", () => {
  it("returns 'all' for clients.view (granted to all roles)", () => {
    expect(resolveListScope(owner, PERMISSIONS.CLIENTS_VIEW)).toBe("all");
    expect(resolveListScope(manager, PERMISSIONS.CLIENTS_VIEW)).toBe("all");
    expect(resolveListScope(employee, PERMISSIONS.CLIENTS_VIEW)).toBe("all");
  });
  it("throws when the role lacks the grant", () => {
    expect(() => resolveListScope(employee, PERMISSIONS.TEAM_INVITE)).toThrow(
      ForbiddenError,
    );
  });
  it("fails closed for unsupported scopes (assigned / team)", () => {
    const a = makeAuthorizer({
      owner: { "clients.view": "assigned" } as GrantMap,
      admin: { "clients.view": "team" } as GrantMap,
      employee: {} as GrantMap,
    });
    expect(() => a.resolveListScope(owner, PERMISSIONS.CLIENTS_VIEW)).toThrow(
      ForbiddenError,
    );
    expect(() => a.resolveListScope(manager, PERMISSIONS.CLIENTS_VIEW)).toThrow(
      ForbiddenError,
    );
  });
});

describe("clients.restore default grants", () => {
  it("owner/manager allowed, employee denied", () => {
    expect(() =>
      requireCapability(owner, PERMISSIONS.CLIENTS_RESTORE),
    ).not.toThrow();
    expect(() =>
      requireCapability(manager, PERMISSIONS.CLIENTS_RESTORE),
    ).not.toThrow();
    expect(() =>
      requireCapability(employee, PERMISSIONS.CLIENTS_RESTORE),
    ).toThrow(ForbiddenError);
  });
});

describe("contacts inherit parent-client scope (unsupported scope denies)", () => {
  it("an 'assigned' contacts grant fails closed (no assignment model)", () => {
    const a = makeAuthorizer({
      owner: { "contacts.view": "assigned" } as GrantMap,
      admin: {} as GrantMap,
      employee: {} as GrantMap,
    });
    expect(
      a.can(owner, PERMISSIONS.CONTACTS_VIEW, {
        parentClient: { orgId: ORG, ownerId: SELF },
      }),
    ).toBe(false);
  });
});
