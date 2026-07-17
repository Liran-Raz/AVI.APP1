import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { writeLocaleCookie } from "@/server/i18n/locale-cookie";
import { setLocaleSchema } from "@/server/validators/locale.schema";

// POST /api/locale
// Body: { locale }
// Sets the UI-language cookie. A pure presentation preference (no auth
// needed — it works on public pages too, and grants nothing). The client
// calls this then router.refresh() so the server layout re-renders with the
// new dir/lang + catalog. Cookies can't be set during render, hence a route.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const input = setLocaleSchema.parse(body);
  await writeLocaleCookie(input.locale);
  return ok({ locale: input.locale });
});
