import { describe, expect, it } from "vitest";

import type { MessageDTO } from "@/lib/api-client";
import { mergeNew, newestMs, reconcile } from "./message-merge";

function m(
  o: Partial<MessageDTO> & { id: string; createdAt: string },
): MessageDTO {
  return {
    id: o.id,
    body: o.body ?? "hi",
    senderId: o.senderId ?? "u1",
    senderName: "A",
    recipientId: null,
    createdAt: o.createdAt,
    editedAt: o.editedAt ?? null,
    deletedAt: o.deletedAt ?? null,
  };
}

const T10 = "2026-07-14T10:00:00+00:00";
const T09 = "2026-07-14T09:00:00+00:00";
const T11 = "2026-07-14T11:00:00+00:00";

describe("reconcile (edits/deletes by others — the delta-poll gap)", () => {
  it("reflects an EDIT by id even though created_at is unchanged", () => {
    const prev = [m({ id: "a", createdAt: T10, body: "old" })];
    const incoming = [
      m({ id: "a", createdAt: T10, body: "new", editedAt: "2026-07-14T10:01:00+00:00" }),
    ];
    const next = reconcile(prev, incoming);
    expect(next).not.toBe(prev);
    expect(next[0].body).toBe("new");
    expect(next[0].editedAt).toBeTruthy();
  });

  it("reflects a soft-DELETE (tombstone) by id", () => {
    const prev = [m({ id: "a", createdAt: T10, body: "secret" })];
    const incoming = [
      m({ id: "a", createdAt: T10, body: "", deletedAt: "2026-07-14T10:02:00+00:00" }),
    ];
    const next = reconcile(prev, incoming);
    expect(next[0].deletedAt).toBeTruthy();
    expect(next[0].body).toBe("");
  });

  it("appends a NEW message and keeps chronological order", () => {
    const prev = [m({ id: "a", createdAt: T10 })];
    const incoming = [m({ id: "a", createdAt: T10 }), m({ id: "b", createdAt: T09 })];
    expect(reconcile(prev, incoming).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("returns the SAME reference when nothing changed (no re-render/scroll)", () => {
    const prev = [m({ id: "a", createdAt: T10, body: "x" })];
    const incoming = [m({ id: "a", createdAt: T10, body: "x" })];
    expect(reconcile(prev, incoming)).toBe(prev);
  });

  it("empty incoming → same reference", () => {
    const prev = [m({ id: "a", createdAt: T10 })];
    expect(reconcile(prev, [])).toBe(prev);
  });
});

describe("mergeNew (optimistic append)", () => {
  it("dedups by id and sorts by time", () => {
    const prev = [m({ id: "a", createdAt: T10 })];
    const next = mergeNew(prev, [
      m({ id: "a", createdAt: T10 }), // dup
      m({ id: "b", createdAt: T09 }), // earlier, fresh
    ]);
    expect(next.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("returns the same reference when nothing is fresh", () => {
    const prev = [m({ id: "a", createdAt: T10 })];
    expect(mergeNew(prev, [m({ id: "a", createdAt: T10 })])).toBe(prev);
  });
});

describe("newestMs", () => {
  it("returns the max createdAt in ms; 0 for empty", () => {
    expect(newestMs([])).toBe(0);
    expect(newestMs([m({ id: "a", createdAt: T10 }), m({ id: "b", createdAt: T11 })])).toBe(
      Date.parse(T11),
    );
  });
});
