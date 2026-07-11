import { describe, it, expect, vi, beforeEach } from "vitest";

import type { FullSession } from "@/server/auth/session";

vi.mock("@/server/repositories/health.repository", () => ({
  pingDb: vi.fn(),
}));

import * as healthRepo from "@/server/repositories/health.repository";
import { checkDbHealth } from "./health.service";

const repo = vi.mocked(healthRepo);

function session(): FullSession {
  return {
    user: { id: "user-1", email: "user@x.test" },
    profile: { id: "user-1", full_name: "Dana Cohen", email: "user@x.test" },
    organization: { id: "org-1", name: "Test Org" },
    activeOrg: { id: "org-1", name: "Test Org" },
    activeRole: "employee",
    memberships: [],
  } as unknown as FullSession;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkDbHealth", () => {
  it("returns { db: 'ok' } when the caller's org row is visible", async () => {
    repo.pingDb.mockResolvedValueOnce(true);
    await expect(checkDbHealth(session())).resolves.toEqual({ db: "ok" });
    expect(repo.pingDb).toHaveBeenCalledWith("org-1");
  });

  it("throws a 503 AppError when the repository throws (DB outage)", async () => {
    repo.pingDb.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(checkDbHealth(session())).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 503,
    });
  });

  it("throws a 503 AppError when the org row is not visible", async () => {
    repo.pingDb.mockResolvedValueOnce(false);
    await expect(checkDbHealth(session())).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 503,
    });
  });
});
