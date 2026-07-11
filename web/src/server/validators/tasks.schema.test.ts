import { describe, it, expect } from "vitest";

import { createTaskSchema, updateTaskSchema } from "./tasks.schema";

// Stage 12 / Round B: the create contract loses `status` and gains a
// mandatory `assignedTo`; `dueAt` becomes optional + nullable on both
// create and update.

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const ISO = "2026-07-01T09:00:00.000Z";

describe("createTaskSchema", () => {
  it("accepts an assignee with no due date (omitted)", () => {
    const r = createTaskSchema.safeParse({ title: "X", assignedTo: VALID_UUID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dueAt ?? null).toBeNull();
  });

  it("accepts an explicit null due date", () => {
    const r = createTaskSchema.safeParse({
      title: "X",
      assignedTo: VALID_UUID,
      dueAt: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a valid ISO due date", () => {
    const r = createTaskSchema.safeParse({
      title: "X",
      assignedTo: VALID_UUID,
      dueAt: ISO,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dueAt).toBe(ISO);
  });

  it("requires an assignee (mandatory in Round B)", () => {
    const r = createTaskSchema.safeParse({ title: "X" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-uuid assignee", () => {
    const r = createTaskSchema.safeParse({ title: "X", assignedTo: "nope" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid due date", () => {
    const r = createTaskSchema.safeParse({
      title: "X",
      assignedTo: VALID_UUID,
      dueAt: "not-a-date",
    });
    expect(r.success).toBe(false);
  });

  it("strips a status field (no longer an input — every task starts 'new')", () => {
    const r = createTaskSchema.safeParse({
      title: "X",
      assignedTo: VALID_UUID,
      status: "done",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).status).toBeUndefined();
    }
  });
});

describe("updateTaskSchema", () => {
  it("allows clearing the due date with null", () => {
    const r = updateTaskSchema.safeParse({ dueAt: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dueAt).toBeNull();
  });

  it("allows setting a due date", () => {
    const r = updateTaskSchema.safeParse({ dueAt: ISO });
    expect(r.success).toBe(true);
  });

  it("rejects an empty patch", () => {
    const r = updateTaskSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
