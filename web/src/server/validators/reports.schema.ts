import { z } from "zod";

// DEV-026 R4 — reports + open-format export query validation.

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

/** Inclusive doc_date range. ISO date strings compare lexicographically. */
// NOT .strict(): both report routes parse Object.fromEntries(searchParams),
// where `format` / `mode` legitimately ride alongside from/to.
export const reportRangeQuerySchema = z
  .object({
    from: dateField,
    to: dateField,
  })
  .refine((r) => r.from <= r.to, {
    message: "Range start must not be after its end",
    path: ["from"],
  });

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

/** JSON report endpoints also serve CSV via ?format=csv. */
export const reportFormatSchema = z.enum(["json", "csv"]).default("json");

/** The open-format endpoint returns a summary preview or the ZIP itself. */
export const openFormatModeSchema = z.enum(["summary", "download"]).default("download");
