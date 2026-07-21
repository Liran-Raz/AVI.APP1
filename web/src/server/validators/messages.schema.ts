import { z } from "zod";

// Office chat validators (Stage 13 R5).
//
// Body is free text — inserted as a parameterized value (no PostgREST .or()
// interpolation), so it needs no character stripping, only a length cap and a
// non-empty check. Labels/messages in English (validator convention); UI is Hebrew.

export const MESSAGE_MAX_LEN = 2000;

// A custom GROUP conversation is addressed as "conv:<uuid>". This lets a single
// `with` string still distinguish the three cases — office ("group"), a DM (a bare
// member uuid), and a group (conv-prefixed conversation id) — so the polling client
// keeps ONE string key (activeKey) and its per-conversation effect stays unchanged.
export const CONVERSATION_PREFIX = "conv:";

// Returns the conversation id if `v` is a well-formed "conv:<uuid>" ref, else null.
export function parseConversationRef(v: string): string | null {
  if (!v.startsWith(CONVERSATION_PREFIX)) return null;
  const id = v.slice(CONVERSATION_PREFIX.length);
  return z.string().uuid().safeParse(id).success ? id : null;
}

export const sendMessageSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Message is empty")
      .max(MESSAGE_MAX_LEN, "Message is too long"),
    // NULL / omitted = office-group message; a uuid = a 1:1 DM recipient.
    recipientId: z.string().uuid("Invalid recipient").nullable().optional(),
    // A custom GROUP conversation id — mutually exclusive with recipientId.
    conversationId: z.string().uuid("Invalid conversation").optional(),
  })
  .strict()
  .refine((v) => !(v.recipientId && v.conversationId), {
    message: "Provide a DM recipient or a group, not both",
    path: ["conversationId"],
  });

export type SendMessagePayload = z.infer<typeof sendMessageSchema>;

// List query for a conversation. `with` = "group" (office feed), a member's uuid
// (DM thread), or "conv:<uuid>" (a custom group). `after` (ISO timestamp) drives the
// polling delta — only messages newer than it are returned. `limit` bounds the page.
// A conversation address (shared by list + mark-read): "group" (office), a member
// uuid (DM), or "conv:<uuid>" (a custom group).
export const conversationWith = z
  .string()
  .refine(
    (v) =>
      v === "group" ||
      z.string().uuid().safeParse(v).success ||
      parseConversationRef(v) !== null,
    { message: "with must be 'group', a member id, or a group conversation id" },
  );

export const listMessagesQuerySchema = z.object({
  with: conversationWith,
  // The poll cursor is a DB `created_at` round-tripped verbatim. PostgREST
  // serializes timestamptz with a numeric offset (…+00:00), NOT a bare `Z`, so
  // { offset: true } is REQUIRED — without it Zod rejects the value and every
  // delta poll 400s (breaking live delivery). Same rule as roles.schema.ts.
  after: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict(); // safe: the route builds { with, after, limit } explicitly, not fromEntries

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

// POST /api/messages/read — mark a conversation read (Stage 14 / R3). Reuses `with`.
export const markReadSchema = z.object({ with: conversationWith }).strict();
export type MarkReadPayload = z.infer<typeof markReadSchema>;

// PATCH /api/messages/[id] — edit a message body (R4; sender + ≤10 min, DB-enforced).
export const editMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message is empty")
    .max(MESSAGE_MAX_LEN, "Message is too long"),
}).strict();
export type EditMessagePayload = z.infer<typeof editMessageSchema>;

// Route param for edit / delete.
export const messageIdParamSchema = z.object({
  id: z.string().uuid("Invalid message id"),
});
