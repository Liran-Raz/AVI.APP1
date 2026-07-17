import "server-only";
import { cookies } from "next/headers";

import { env } from "@/server/env";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/i18n/config";

// UI locale cookie read/write (DEV-010 i18n).
//
// The cookie stores the user's chosen interface language. A pure
// PRESENTATION preference — never a trust boundary. It only decides which
// message catalog + text direction the UI renders; it grants no access and
// touches no data. A tampered/unknown value falls back to the default.
//
// Reading works in any server context (layouts, pages, route handlers).
// WRITING only works in Route Handlers / Server Actions (a Next.js
// restriction) — never call the writer from a Server Component render. The
// switcher goes through POST /api/locale.

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export async function readLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export async function writeLocaleCookie(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    // Not httpOnly: a non-sensitive presentation flag. Keeping it readable
    // by JS is harmless and enables a future client-only fast path.
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
