import { z } from "zod";

// Boolean coming in as a URL query string ("true" / "false" / "1" / "0")
const booleanQueryField = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return false;
  const s = v.toLowerCase().trim();
  return s === "true" || s === "1" || s === "yes";
}, z.boolean().default(false));

const limitField = z.preprocess(
  (v) => (typeof v === "string" && v.length > 0 ? Number(v) : v),
  z.number().int().min(1).max(100).default(20),
);

export const listNotificationsQuerySchema = z.object({
  unreadOnly: booleanQueryField,
  limit: limitField,
});

export const notificationIdParamSchema = z.object({
  id: z.string().uuid("Invalid notification id"),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
