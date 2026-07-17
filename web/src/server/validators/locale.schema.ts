import { z } from "zod";

import { SUPPORTED_LOCALES } from "@/i18n/config";

// Body for POST /api/locale — the chosen UI language. Constrained to the
// supported set (adding a locale in i18n/config.ts widens this automatically).
export const setLocaleSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
});

export type SetLocalePayload = z.infer<typeof setLocaleSchema>;
