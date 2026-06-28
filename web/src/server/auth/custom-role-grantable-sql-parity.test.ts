// Parity guard: the DB-side allowlist in custom_role_grant_check
// (supabase/migrations/0016_role_management_rpcs.sql) MUST equal
// CUSTOM_ROLE_GRANTABLE_PERMISSIONS, and each key's scoped flag MUST match
// PERMISSION_META. Fails on drift between the SQL allowlist and the TS catalog.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  CUSTOM_ROLE_GRANTABLE_PERMISSIONS,
  PERMISSION_META,
  type Permission,
} from "./permissions";

const SQL = readFileSync(
  resolve(
    process.cwd(),
    "..",
    "supabase/migrations/0016_role_management_rpcs.sql",
  ),
  "utf8",
);

// Only custom_role_grant_check uses the ('key', true|false) shape.
function parseDbAllowlist(): Map<string, boolean> {
  const m = new Map<string, boolean>();
  const re = /\('([a-z][a-z._]*)',\s*(true|false)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(SQL)) !== null) {
    m.set(match[1], match[2] === "true");
  }
  return m;
}

describe("custom_role_grant_check SQL <-> TS parity", () => {
  const db = parseDbAllowlist();

  it("DB allowlist has the same keys as CUSTOM_ROLE_GRANTABLE_PERMISSIONS", () => {
    expect(db.size).toBeGreaterThan(0);
    expect([...db.keys()].sort()).toEqual(
      [...CUSTOM_ROLE_GRANTABLE_PERMISSIONS].sort(),
    );
  });

  it("each DB scoped flag matches PERMISSION_META", () => {
    for (const [key, scoped] of db) {
      expect(scoped, `scoped flag for ${key}`).toBe(
        PERMISSION_META[key as Permission].scoped,
      );
    }
  });
});
