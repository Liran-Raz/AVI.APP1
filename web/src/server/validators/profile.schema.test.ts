import { describe, expect, it } from "vitest";

import { updateNotificationPrefsSchema } from "./profile.schema";

// DEV-014 — the notification-prefs PATCH schema now carries two independent
// boolean toggles (email + in-app bell) for the task-assignment event.
describe("updateNotificationPrefsSchema", () => {
  it("accepts emailOnTaskAssignment alone", () => {
    const r = updateNotificationPrefsSchema.safeParse({
      emailOnTaskAssignment: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ emailOnTaskAssignment: false });
  });

  it("accepts bellOnTaskAssignment alone", () => {
    const r = updateNotificationPrefsSchema.safeParse({
      bellOnTaskAssignment: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ bellOnTaskAssignment: false });
  });

  it("accepts both keys together", () => {
    expect(
      updateNotificationPrefsSchema.safeParse({
        emailOnTaskAssignment: true,
        bellOnTaskAssignment: false,
      }).success,
    ).toBe(true);
  });

  it("rejects an empty object — at least one preference is required", () => {
    expect(updateNotificationPrefsSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    expect(
      updateNotificationPrefsSchema.safeParse({ bellOnTaskAssignment: "no" })
        .success,
    ).toBe(false);
  });
});
