import { describe, expect, it } from "vitest";

import {
  PERMISSION_META,
  PERMISSIONS,
  PROTECTED_ACTIONS,
  RECORD_SCOPES,
  SUPPORTED_RECORD_SCOPES,
  type Permission,
} from "./permissions";
import { ROLE_GRANTS } from "./permission-grants";
import { isGrantablePermission } from "./authorization";

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];
const VALID_CONTEXT_KINDS = new Set([
  "none",
  "client",
  "contact",
  "task",
  "task_assignment",
  "team_member",
]);

describe("permission catalog integrity", () => {
  it("PERMISSION_META covers exactly the permission catalog", () => {
    const metaKeys = Object.keys(PERMISSION_META).sort();
    const permKeys = [...ALL_PERMISSIONS].sort();
    expect(metaKeys).toEqual(permKeys);
  });

  it("every permission has a valid context kind and boolean scoped flag", () => {
    for (const p of ALL_PERMISSIONS) {
      const meta = PERMISSION_META[p];
      expect(VALID_CONTEXT_KINDS.has(meta.context)).toBe(true);
      expect(typeof meta.scoped).toBe("boolean");
    }
  });

  it("only record-bearing kinds are marked scoped", () => {
    for (const p of ALL_PERMISSIONS) {
      const meta = PERMISSION_META[p];
      if (meta.scoped) {
        expect(["client", "contact", "task"]).toContain(meta.context);
      }
    }
  });

  it("supported scopes are a subset of all record scopes", () => {
    for (const s of SUPPORTED_RECORD_SCOPES) {
      expect(RECORD_SCOPES).toContain(s);
    }
    // assigned / team are intentionally NOT supported yet
    expect(SUPPORTED_RECORD_SCOPES).not.toContain("assigned");
    expect(SUPPORTED_RECORD_SCOPES).not.toContain("team");
  });
});

describe("protected ownership action is not grantable", () => {
  it("ownership.transfer is not in the permission catalog", () => {
    expect(ALL_PERMISSIONS).not.toContain(
      PROTECTED_ACTIONS.OWNERSHIP_TRANSFER as unknown as Permission,
    );
    expect(isGrantablePermission(PROTECTED_ACTIONS.OWNERSHIP_TRANSFER)).toBe(
      false,
    );
  });

  it("ownership.transfer appears in no role grant", () => {
    for (const role of ["owner", "admin", "employee"] as const) {
      expect(
        PROTECTED_ACTIONS.OWNERSHIP_TRANSFER in ROLE_GRANTS[role],
      ).toBe(false);
    }
  });
});

describe("role grants integrity (compatibility with current role keys)", () => {
  it("defines exactly owner/admin/employee", () => {
    expect(Object.keys(ROLE_GRANTS).sort()).toEqual(
      ["admin", "employee", "owner"].sort(),
    );
  });

  it("every grant key is a real grantable permission", () => {
    for (const role of ["owner", "admin", "employee"] as const) {
      for (const key of Object.keys(ROLE_GRANTS[role])) {
        expect(isGrantablePermission(key)).toBe(true);
      }
    }
  });

  it("every scoped grant uses a supported scope; capability grants use true", () => {
    for (const role of ["owner", "admin", "employee"] as const) {
      const grants = ROLE_GRANTS[role];
      for (const key of Object.keys(grants) as Permission[]) {
        const value = grants[key];
        const meta = PERMISSION_META[key];
        if (meta.scoped) {
          // default grants only use "all" today
          expect(SUPPORTED_RECORD_SCOPES).toContain(value);
        } else {
          expect(value).toBe(true);
        }
      }
    }
  });
});
