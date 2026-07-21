import { z } from "zod";

// Group-conversation validators (Stage 14 / R2). Labels/messages in English
// (validator convention); the UI renders Hebrew. Titles are inserted as
// parameterized values via a SECURITY DEFINER RPC (no interpolation), so they
// need only a length cap + non-empty check. org_id + sender identity are never
// accepted from the client — they come from the session / auth.uid() in the RPC.

export const GROUP_TITLE_MAX = 80; // mirrors conversations_title_len (1..80)
export const GROUP_MEMBERS_MAX = 200; // sanity cap on the initial member array

const groupTitle = z
  .string()
  .trim()
  .min(1, "Group name is required")
  .max(GROUP_TITLE_MAX, "Group name is too long");

// POST /api/conversations — create a group. memberIds are the OTHER members
// (the creator is added as admin by the RPC); ids of non-members / the creator
// are ignored server-side.
export const createGroupSchema = z.object({
  title: groupTitle,
  memberIds: z
    .array(z.string().uuid("Invalid member id"))
    .max(GROUP_MEMBERS_MAX, "Too many members")
    .default([]),
}).strict();
export type CreateGroupPayload = z.infer<typeof createGroupSchema>;

// PATCH /api/conversations/[conversationId] — rename (admin only, enforced in DB).
export const renameGroupSchema = z.object({ title: groupTitle }).strict();
export type RenameGroupPayload = z.infer<typeof renameGroupSchema>;

// POST /api/conversations/[conversationId]/members — add a member (admin only).
export const addGroupMemberSchema = z.object({
  userId: z.string().uuid("Invalid member id"),
}).strict();
export type AddGroupMemberPayload = z.infer<typeof addGroupMemberSchema>;

// Route params.
export const conversationIdParamSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation id"),
});
export const groupMemberParamsSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation id"),
  userId: z.string().uuid("Invalid member id"),
});
