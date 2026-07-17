"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

import type { Locale } from "./config";
import {
  translate,
  type Messages,
  type TFunction,
} from "./messages-types";

// Client-side locale context (DEV-010 i18n). The ROOT server layout reads
// the locale cookie and injects the SAME locale + active catalog here as
// props, so server and client agree on first paint — no hydration mismatch,
// no "default-then-swap" flash.

type LocaleContextValue = {
  locale: Locale;
  t: TFunction;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const t = useCallback<TFunction>(
    (key, vars) => translate(messages, key, vars),
    [messages],
  );
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useT / useLocale must be used within <LocaleProvider>");
  }
  return ctx;
}

// The translator. Usage: `const t = useT(); t("nav.tasks")`.
export function useT(): TFunction {
  return useLocaleContext().t;
}

// The active locale (for date/number formatting, dir-aware bits, the switcher).
export function useLocale(): Locale {
  return useLocaleContext().locale;
}
