import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";

// Mock the repositories so importing the service doesn't boot the Supabase
// client / env. readNotificationPrefs (from profile.service) stays REAL — it's
// a pure resolver — so the soft-mute decision is exercised for real.
vi.mock("@/server/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://app.example.test" },
}));
vi.mock("@/server/repositories/notifications.repository", () => ({
  findManyByUserId: vi.fn(),
  countUnreadByUserId: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
vi.mock("@/server/repositories/profile.repository", () => ({
  updateOwnProfile: vi.fn(),
  findByUserId: vi.fn(),
}));

import * as notificationsRepo from "@/server/repositories/notifications.repository";
import {
  getUnreadCount,
  listNotifications,
} from "@/server/services/notifications.service";

function sessionWithPrefs(prefs: unknown): FullSession {
  return {
    profile: { id: "u1", notification_prefs: prefs },
  } as unknown as FullSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notificationsRepo.findManyByUserId).mockResolvedValue([]);
  vi.mocked(notificationsRepo.countUnreadByUserId).mockResolvedValue(0);
});

// DEV-014 soft-mute: when the caller muted the assignment bell, the red badge
// (COUNT) drops task_assigned, but the bell LIST still shows it.
describe("notifications.service — bell soft-mute (DEV-014)", () => {
  it("getUnreadCount EXCLUDES task_assigned from the badge count when the bell is muted", async () => {
    await getUnreadCount(sessionWithPrefs({ bellOnTaskAssignment: false }));
    expect(notificationsRepo.countUnreadByUserId).toHaveBeenCalledWith("u1", {
      excludeTypes: ["task_assigned"],
    });
  });

  it("getUnreadCount excludes NOTHING when the bell is ON (default / absent key)", async () => {
    await getUnreadCount(sessionWithPrefs({}));
    expect(notificationsRepo.countUnreadByUserId).toHaveBeenCalledWith("u1", {
      excludeTypes: [],
    });
  });

  it("listNotifications keeps the muted assignment in the LIST but drops it from the COUNT", async () => {
    await listNotifications(sessionWithPrefs({ bellOnTaskAssignment: false }), {
      unreadOnly: false,
      limit: 20,
    });

    // The list is NOT filtered — a soft-muted assignment still shows in the bell.
    expect(notificationsRepo.findManyByUserId).toHaveBeenCalledWith("u1", {
      unreadOnly: false,
      limit: 20,
    });
    // Only the red badge count drops the muted type.
    expect(notificationsRepo.countUnreadByUserId).toHaveBeenCalledWith("u1", {
      excludeTypes: ["task_assigned"],
    });
  });
});
