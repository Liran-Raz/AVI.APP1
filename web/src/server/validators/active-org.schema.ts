import { z } from "zod";

// Switch the active office. The client sends the target org's UUID; the
// server validates the user actually has an ACTIVE membership there
// before trusting it. org_id is NEVER read from request bodies for data
// scoping — only for this explicit, validated switch.

export const setActiveOrgSchema = z.object({
  orgId: z.string().uuid("orgId must be a valid UUID"),
});

export type SetActiveOrgPayload = z.infer<typeof setActiveOrgSchema>;
