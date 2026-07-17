// UI-locale configuration (DEV-010 i18n).
//
// PURE, shared config — no "server-only", no next/headers — so both client
// components (the switcher, the provider) and server code (the cookie
// reader, the layout) import the SAME source of truth. The cookie
// read/write lives in server/i18n/locale-cookie.ts (server-only).

// Supported UI locales. Round 1 ships he + en; round 2 extends this tuple
// (ru/de/fr/ja/it/ar) + adds the matching message catalog + font. Adding a
// locale here is the single switch that lights it up across the app.
export const SUPPORTED_LOCALES = ["he", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "he";

export const LOCALE_COOKIE = "avi-locale";

// RTL locales. Hebrew today; Arabic joins in round 2.
const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["he"]);

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

// Native display name per locale, for the switcher — each shown in its own
// script so a user recognizes their language regardless of the current UI
// language.
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  he: "עברית",
  en: "English",
};

// BCP-47 tag per locale, for Intl date/number formatting (toLocaleString,
// Intl.DateTimeFormat, date-fns). Keeps dates/times in the user's language
// instead of a hardcoded "he-IL". Round 2 extends this alongside SUPPORTED.
const INTL_TAG: Record<Locale, string> = {
  he: "he-IL",
  en: "en-GB",
};

export function intlLocale(locale: Locale): string {
  return INTL_TAG[locale];
}
