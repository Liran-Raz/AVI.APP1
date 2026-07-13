import { describe, expect, it } from "vitest";

import {
  addGroupMemberSchema,
  conversationIdParamSchema,
  createGroupSchema,
  groupMemberParamsSchema,
  renameGroupSchema,
} from "@/server/validators/conversations.schema";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

describe("createGroupSchema", () => {
  it("requires a 1..80 char title and trims it", () => {
    expect(createGroupSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createGroupSchema.parse({ title: "  צוות מיסים  " }).title).toBe("צוות מיסים");
    expect(createGroupSchema.safeParse({ title: "x".repeat(81) }).success).toBe(false);
    expect(createGroupSchema.safeParse({ title: "x".repeat(80) }).success).toBe(true);
  });

  it("defaults memberIds to [] and validates each is a uuid", () => {
    expect(createGroupSchema.parse({ title: "g" }).memberIds).toEqual([]);
    expect(
      createGroupSchema.parse({ title: "g", memberIds: [UUID, UUID2] }).memberIds,
    ).toHaveLength(2);
    expect(createGroupSchema.safeParse({ title: "g", memberIds: ["nope"] }).success).toBe(false);
  });

  it("caps the member array length", () => {
    const many = Array.from({ length: 201 }, () => UUID);
    expect(createGroupSchema.safeParse({ title: "g", memberIds: many }).success).toBe(false);
  });
});

describe("renameGroupSchema", () => {
  it("requires a 1..80 char title", () => {
    expect(renameGroupSchema.safeParse({ title: "" }).success).toBe(false);
    expect(renameGroupSchema.parse({ title: " שם חדש " }).title).toBe("שם חדש");
    expect(renameGroupSchema.safeParse({ title: "x".repeat(81) }).success).toBe(false);
  });
});

describe("addGroupMemberSchema", () => {
  it("requires a uuid userId", () => {
    expect(addGroupMemberSchema.safeParse({ userId: UUID }).success).toBe(true);
    expect(addGroupMemberSchema.safeParse({ userId: "nope" }).success).toBe(false);
    expect(addGroupMemberSchema.safeParse({}).success).toBe(false);
  });
});

describe("route param schemas", () => {
  it("validate uuid path params", () => {
    expect(conversationIdParamSchema.safeParse({ conversationId: UUID }).success).toBe(true);
    expect(conversationIdParamSchema.safeParse({ conversationId: "x" }).success).toBe(false);
    expect(
      groupMemberParamsSchema.safeParse({ conversationId: UUID, userId: UUID2 }).success,
    ).toBe(true);
    expect(
      groupMemberParamsSchema.safeParse({ conversationId: UUID, userId: "x" }).success,
    ).toBe(false);
  });
});
