"use client";

// Marketing-only i18n. Deliberately tiny and self-contained: a React context
// holds the current language, `t(he, en)` picks the string at render time, and
// the direction (rtl/ltr) is applied to the `.mkt` wrapper element ONLY — never
// to `document` — so an English/LTR marketing view can never leak into the
// authenticated Hebrew app. Persisted to localStorage so the choice survives
// navigation between marketing pages.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type MktLang = "he" | "en";

type MktLangValue = {
  lang: MktLang;
  dir: "rtl" | "ltr";
  t: (he: string, en: string) => string;
  toggle: () => void;
};

const STORAGE_KEY = "avi-mkt-lang";
const MarketingLangContext = createContext<MktLangValue | null>(null);

export function MarketingLangProvider({ children }: { children: ReactNode }) {
  // Default to Hebrew on both server and first client render (avoids hydration
  // mismatch); adopt the persisted choice right after mount.
  const [lang, setLang] = useState<MktLang>("he");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // One-time SSR-safe hydration: server + first client render default to
      // Hebrew (no mismatch), then adopt the persisted choice after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "en" || saved === "he") setLang(saved);
    } catch {
      /* localStorage unavailable — stay Hebrew */
    }
  }, []);

  const toggle = useCallback(() => {
    setLang((prev) => {
      const next: MktLang = prev === "he" ? "en" : "he";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const t = useCallback(
    (he: string, en: string) => (lang === "en" ? en : he),
    [lang],
  );

  const value: MktLangValue = {
    lang,
    dir: lang === "en" ? "ltr" : "rtl",
    t,
    toggle,
  };

  return (
    <MarketingLangContext.Provider value={value}>
      {children}
    </MarketingLangContext.Provider>
  );
}

export function useMarketingLang(): MktLangValue {
  const ctx = useContext(MarketingLangContext);
  if (!ctx) {
    throw new Error("useMarketingLang must be used within <MarketingLangProvider>");
  }
  return ctx;
}

/** Language pill for the marketing nav / auth top-bar. */
export function LangToggle() {
  const { lang, toggle } = useMarketingLang();
  return (
    <button
      type="button"
      className="lang-btn"
      onClick={toggle}
      aria-label={lang === "he" ? "Switch to English" : "החלף לעברית"}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span>{lang === "he" ? "EN" : "עברית"}</span>
    </button>
  );
}

/** Fixed aurora backdrop the glass refracts. Purely decorative. */
export function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <div className="a-blob b1" />
      <div className="a-blob b2" />
      <div className="a-blob b3" />
      <div className="a-blob b4" />
      <div className="grain" />
    </div>
  );
}
