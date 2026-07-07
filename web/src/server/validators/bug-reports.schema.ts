import { z } from "zod";

// Server-side validation for in-app bug reports ("מצאת תקלה?", DEV-002).
// The client_logs snapshot is collected entirely client-side (recent console
// errors, failed requests, a short action trail) — every array here is
// capped so a malformed or oversized client payload can't reach the DB.
// This IS the enforcement point; the table itself carries no size CHECKs
// for client_logs (see the 0018 migration comment).

const descriptionField = z
  .string()
  .trim()
  .min(1, "Description is required")
  .max(2000, "Description must be at most 2000 characters");

// Optional "what were you trying to do" field. Empty/whitespace coerces to
// null, same pattern as roles.schema.ts's descriptionField.
const attemptedActionField = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v ?? null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  },
  z
    .string()
    .max(500, "Attempted action must be at most 500 characters")
    .nullable(),
);

// ISO-ish timestamp string captured client-side (Date.toISOString()). Not
// strictly validated as a real date — this is diagnostic data, not a
// security boundary — only bounded in length.
const timestampField = z.string().max(40);

const consoleErrorEntrySchema = z.object({
  message: z.string().max(500),
  timestamp: timestampField,
});

const failedRequestEntrySchema = z.object({
  url: z.string().max(300),
  method: z.string().max(10),
  status: z.number().int().optional(),
  timestamp: timestampField,
});

const actionEntrySchema = z.object({
  label: z.string().max(200),
  timestamp: timestampField,
});

// Caps mirror the ring-buffer sizes in lib/bug-report-tracker.ts — kept in
// sync manually (both are small, stable constants).
const clientLogsSchema = z
  .object({
    consoleErrors: z.array(consoleErrorEntrySchema).max(20).default([]),
    failedRequests: z.array(failedRequestEntrySchema).max(20).default([]),
    actionTrail: z.array(actionEntrySchema).max(30).default([]),
  })
  .default({ consoleErrors: [], failedRequests: [], actionTrail: [] });

export const createBugReportSchema = z.object({
  description: descriptionField,
  attemptedAction: attemptedActionField,
  pageUrl: z.string().trim().min(1, "pageUrl is required").max(500),
  userAgent: z.string().trim().max(500).nullish(),
  clientLogs: clientLogsSchema,
});

export type CreateBugReportPayload = z.infer<typeof createBugReportSchema>;
export type ClientLogsPayload = z.infer<typeof clientLogsSchema>;
