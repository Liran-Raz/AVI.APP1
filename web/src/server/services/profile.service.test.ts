import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";

// Keep importing profile.service from booting env / the Supabase client.
vi.mock("@/server/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://app.example.test" },
}));
vi.mock("@/server/repositories/profile.repository", () => ({
  updateOwnProfile: vi.fn(),
}));

import * as profileRepo from "@/server/repositories/profile.repository";
import {
  NOTIFICATION_PREFS_DEFAULTS,
  readNotificationPrefs,
  updateMyNotificationPrefs,
} from "@/server/services/profile.service";

// DEV-014 — a second boolean key (bellOnTaskAssignment) joined the resolver.
describe("readNotificationPrefs", () => {
  it("defaults every key ON when the stored value is empty", () => {
    expect(readNotificationPrefs({})).toEqual({
      emailOnTaskAssignment: true,
      bellOnTaskAssignment: true,
    });
    expect(NOTIFICATION_PREFS_DEFAULTS.bellOnTaskAssignment).toBe(true);
  });

  it("defaults every key ON for null / non-object input", () => {
    expect(readNotificationPrefs(null)).toEqual({
      emailOnTaskAssignment: true,
      bellOnTaskAssignment: true,
    });
    expect(readNotificationPrefs("nonsense")).toEqual({
      emailOnTaskAssignment: true,
      bellOnTaskAssignment: true,
    });
  });

  it("respects an explicit bellOnTaskAssignment=false and defaults the missing email key ON", () => {
    expect(readNotificationPrefs({ bellOnTaskAssignment: false })).toEqual({
      emailOnTaskAssignment: true,
      bellOnTaskAssignment: false,
    });
  });

  it("falls back to default ON for non-boolean per-key values", () => {
    expect(
      readNotificationPrefs({
        bellOnTaskAssignment: "off",
        emailOnTaskAssignment: 0,
      }),
    ).toEqual({ emailOnTaskAssignment: true, bellOnTaskAssignment: true });
  });
});

describe("updateMyNotificationPrefs — partial merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges a partial patch over the stored prefs (bell off keeps email on)", async () => {
    vi.mocked(profileRepo.updateOwnProfile).mockResolvedValue({
      notification_prefs: {
        emailOnTaskAssignment: true,
        bellOnTaskAssignment: false,
      },
    } as never);

    const session = {
      user: { id: "u1" },
      profile: { notification_prefs: { emailOnTaskAssignment: true } },
    } as unknown as FullSession;

    const result = await updateMyNotificationPrefs(session, {
      bellOnTaskAssignment: false,
    });

    // The full merged blob is persisted (current email:true kept, bell:false set).
    expect(profileRepo.updateOwnProfile).toHaveBeenCalledWith("u1", {
      notification_prefs: {
        emailOnTaskAssignment: true,
        bellOnTaskAssignment: false,
      },
    });
    expect(result).toEqual({
      emailOnTaskAssignment: true,
      bellOnTaskAssignment: false,
    });
  });
});
