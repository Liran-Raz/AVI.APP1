import { describe, expect, it } from "vitest";

import {
  CONVERSATION_PREFIX,
  listMessagesQuerySchema,
  parseConversationRef,
  sendMessageSchema,
} from "@/server/validators/messages.schema";

describe("listMessagesQuerySchema", () => {
  it("accepts a PostgREST timestamptz cursor (numeric +00:00 offset) — regression for the dead-poll bug", () => {
    // This is exactly what the client feeds back as `after`; without
    // { offset: true } Zod rejects it and every delta poll 400s.
    const r = listMessagesQuerySchema.safeParse({
      with: "group",
      after: "2026-07-12T10:30:00.123456+00:00",
    });
    expect(r.success).toBe(true);
  });

  it("also accepts a Z-suffixed UTC cursor", () => {
    expect(
      listMessagesQuerySchema.safeParse({
        with: "group",
        after: "2026-07-12T10:30:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("accepts with=group and a uuid member id, rejects garbage", () => {
    expect(listMessagesQuerySchema.safeParse({ with: "group" }).success).toBe(true);
    expect(
      listMessagesQuerySchema.safeParse({
        with: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(listMessagesQuerySchema.safeParse({ with: "not-a-uuid" }).success).toBe(false);
  });

  it("defaults limit to 50 and caps it at 100", () => {
    expect(listMessagesQuerySchema.parse({ with: "group" }).limit).toBe(50);
    expect(
      listMessagesQuerySchema.safeParse({ with: "group", limit: 999 }).success,
    ).toBe(false);
  });

  it("rejects a non-timestamp after", () => {
    expect(
      listMessagesQuerySchema.safeParse({ with: "group", after: "yesterday" }).success,
    ).toBe(false);
  });
});

describe("sendMessageSchema", () => {
  it("trims and requires a non-empty body", () => {
    expect(sendMessageSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(sendMessageSchema.parse({ body: "  hi  " }).body).toBe("hi");
  });

  it("accepts null/omitted recipientId (group) and a uuid (DM), rejects a bad id", () => {
    expect(sendMessageSchema.safeParse({ body: "x" }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ body: "x", recipientId: null }).success).toBe(true);
    expect(
      sendMessageSchema.safeParse({
        body: "x",
        recipientId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(sendMessageSchema.safeParse({ body: "x", recipientId: "nope" }).success).toBe(false);
  });
});

describe("group conversation addressing (Stage 14 / R2)", () => {
  const CONV = "22222222-2222-4222-8222-222222222222";
  const MEMBER = "11111111-1111-4111-8111-111111111111";

  it("parseConversationRef extracts a conv:<uuid>, else null", () => {
    expect(parseConversationRef(`${CONVERSATION_PREFIX}${CONV}`)).toBe(CONV);
    expect(parseConversationRef(CONV)).toBeNull(); // a bare uuid is a DM, not a group
    expect(parseConversationRef("conv:not-a-uuid")).toBeNull();
    expect(parseConversationRef("group")).toBeNull();
  });

  it("listMessagesQuerySchema accepts with=conv:<uuid>, rejects a malformed ref", () => {
    expect(listMessagesQuerySchema.safeParse({ with: `conv:${CONV}` }).success).toBe(true);
    expect(listMessagesQuerySchema.safeParse({ with: "conv:not-a-uuid" }).success).toBe(false);
  });

  it("sendMessageSchema accepts a conversationId (group), but not together with recipientId", () => {
    expect(sendMessageSchema.safeParse({ body: "x", conversationId: CONV }).success).toBe(true);
    expect(
      sendMessageSchema.safeParse({ body: "x", conversationId: CONV, recipientId: MEMBER }).success,
    ).toBe(false); // mutually exclusive
  });
});
