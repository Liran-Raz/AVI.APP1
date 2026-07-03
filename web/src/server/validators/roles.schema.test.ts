import { describe, it, expect } from "vitest";

import {
  createRoleSchema,
  duplicateRoleSchema,
  updateRoleSchema,
} from "./roles.schema";

const base = { name: "Bookkeeper", description: null, permissions: [] };

describe("createRoleSchema", () => {
  it("accepts a valid custom role", () => {
    const r = createRoleSchema.safeParse({
      ...base,
      permissions: [
        { permissionKey: "clients.view", recordScope: "all" },
        { permissionKey: "team.view" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty / whitespace name", () => {
    expect(createRoleSchema.safeParse({ ...base, name: "   " }).success).toBe(
      false,
    );
  });

  it("rejects a name longer than 100 chars", () => {
    expect(
      createRoleSchema.safeParse({ ...base, name: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("rejects an unknown permission key", () => {
    expect(
      createRoleSchema.safeParse({
        ...base,
        permissions: [{ permissionKey: "bogus.permission" }],
      }).success,
    ).toBe(false);
  });

  it("rejects ownership.transfer (protected, non-grantable)", () => {
    expect(
      createRoleSchema.safeParse({
        ...base,
        permissions: [{ permissionKey: "ownership.transfer" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a scoped permission with no scope", () => {
    expect(
      createRoleSchema.safeParse({
        ...base,
        permissions: [{ permissionKey: "clients.view" }],
      }).success,
    ).toBe(false);
  });

  it("rejects an unsupported scope (assigned / team)", () => {
    for (const scope of ["assigned", "team", "bogus"]) {
      expect(
        createRoleSchema.safeParse({
          ...base,
          permissions: [{ permissionKey: "clients.view", recordScope: scope }],
        }).success,
        scope,
      ).toBe(false);
    }
  });

  it("rejects a scope on a contextless permission", () => {
    expect(
      createRoleSchema.safeParse({
        ...base,
        permissions: [{ permissionKey: "team.view", recordScope: "all" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate permission keys", () => {
    expect(
      createRoleSchema.safeParse({
        ...base,
        permissions: [
          { permissionKey: "clients.view", recordScope: "all" },
          { permissionKey: "clients.view", recordScope: "own" },
        ],
      }).success,
    ).toBe(false);
  });

  it("coerces empty / whitespace description to null", () => {
    const r = createRoleSchema.parse({ ...base, description: "   " });
    expect(r.description).toBeNull();
  });

  it("trims the role name", () => {
    const r = createRoleSchema.parse({ ...base, name: "  Senior Clerk  " });
    expect(r.name).toBe("Senior Clerk");
  });
});

describe("updateRoleSchema", () => {
  it("requires expectedUpdatedAt (optimistic-concurrency token)", () => {
    expect(
      updateRoleSchema.safeParse({ name: "X", description: null, permissions: [] })
        .success,
    ).toBe(false);
  });
  it("accepts a valid update", () => {
    expect(
      updateRoleSchema.safeParse({
        name: "X",
        description: null,
        permissions: [],
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
      }).success,
    ).toBe(true);
  });
});

describe("duplicateRoleSchema", () => {
  it("requires a non-empty name", () => {
    expect(duplicateRoleSchema.safeParse({}).success).toBe(false);
    expect(duplicateRoleSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(duplicateRoleSchema.safeParse({ name: "Copy of Owner" }).success).toBe(
      true,
    );
  });
});
