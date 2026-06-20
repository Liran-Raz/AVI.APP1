import { describe, expect, it } from "vitest";

import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";

const caps: Capability[] = [
  { permission: "clients.view", recordScope: "all" },
  { permission: "team.invite" },
  { permission: "contacts.delete", recordScope: "all" },
];

describe("hasCapability (client-safe, fail-closed)", () => {
  it("true for an exact permission match (no scope required)", () => {
    expect(hasCapability(caps, PERMISSIONS.TEAM_INVITE)).toBe(true);
    expect(hasCapability(caps, PERMISSIONS.CONTACTS_DELETE)).toBe(true);
  });

  it("respects recordScope when provided", () => {
    expect(hasCapability(caps, PERMISSIONS.CLIENTS_VIEW, "all")).toBe(true);
    expect(hasCapability(caps, PERMISSIONS.CLIENTS_VIEW, "own")).toBe(false);
    expect(hasCapability(caps, PERMISSIONS.CLIENTS_VIEW)).toBe(true);
  });

  it("false for a permission that is not granted", () => {
    expect(hasCapability(caps, PERMISSIONS.ORGANIZATION_SETTINGS)).toBe(false);
    expect(hasCapability(caps, PERMISSIONS.CLIENTS_ARCHIVE)).toBe(false);
  });

  it("unknown permission = false", () => {
    expect(hasCapability(caps, "bogus.permission" as never)).toBe(false);
  });

  it("missing / malformed capabilities = false (never an implicit allow)", () => {
    expect(hasCapability(undefined, PERMISSIONS.TEAM_INVITE)).toBe(false);
    expect(hasCapability(null, PERMISSIONS.TEAM_INVITE)).toBe(false);
    expect(hasCapability("nope" as never, PERMISSIONS.TEAM_INVITE)).toBe(false);
    expect(hasCapability([] as Capability[], PERMISSIONS.TEAM_INVITE)).toBe(
      false,
    );
    expect(
      hasCapability(
        [null as never, undefined as never],
        PERMISSIONS.TEAM_INVITE,
      ),
    ).toBe(false);
  });
});
