import { z } from "zod";

// Office chat validators (Stage 13 R5).
//
// Body is free text — inserted as a parameterized value (no PostgREST .or()
// interpolation), so it needs no character stripping, only a length cap and a
// non-empty check. Labels/messages in English (validator convention); UI is Hebrew.

export const MESSAGE_MAX_LEN = 2000;

export const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message is empty")
    .max(MESSAGE_MAX_LEN, "Message is too long"),
  // NULL / omitted = office-group message; a uuid = a 1:1 DM recipient.
  recipientId: z.string().uuid("Invalid recipient").nullable().optional(),
});

export type SendMessagePayload = z.infer<typeof sendMessageSchema>;

// List query for a conversation. `with` = "group" (office feed) or a member's
// uuid (DM thread). `after` (ISO timestamp) drives the polling delta — only
// messages newer than it are returned. `limit` bounds the initial page.
export const listMessagesQuerySchema = z.object({
  with: z
    .string()
    .refine((v) => v === "group" || z.string().uuid().safeParse(v).success, {
      message: "with must be 'group' or a member id",
    }),
  // The poll cursor is a DB `created_at` round-tripped verbatim. PostgREST
  // serializes timestamptz with a numeric offset (…+00:00), NOT a bare `Z`, so
  // { offset: true } is REQUIRED — without it Zod rejects the value and every
  // delta poll 400s (breaking live delivery). Same rule as roles.schema.ts.
  after: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
