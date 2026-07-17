import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

// Inline SVG flags per locale. Emoji flags (🇮🇱) are NOT used because Windows
// renders them as the two-letter code ("IL") instead of a flag — inline SVG
// is crisp and identical on every OS. Decorative (aria-hidden): the language
// NAME is always shown beside it. Round 2 adds ru/de/fr/ja/it/ar here — the
// Record<Locale,…> type forces every locale to have one.
const FLAGS: Record<Locale, React.ReactNode> = {
  // Israel
  he: (
    <svg viewBox="0 0 60 40" className="block h-full w-full">
      <rect width="60" height="40" fill="#fff" />
      <rect y="5.5" width="60" height="5" fill="#0038b8" />
      <rect y="29.5" width="60" height="5" fill="#0038b8" />
      <g fill="none" stroke="#0038b8" strokeWidth="1.5">
        <polygon points="30,13 35.4,22.3 24.6,22.3" />
        <polygon points="30,27 35.4,17.7 24.6,17.7" />
      </g>
    </svg>
  ),
  // United Kingdom (English)
  en: (
    <svg viewBox="0 0 60 40" className="block h-full w-full">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 60,40 M60,0 0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 60,40 M60,0 0,40" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="12" />
      <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="7" />
    </svg>
  ),
};

export function Flag({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-[14px] w-5 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10",
        className,
      )}
    >
      {FLAGS[locale]}
    </span>
  );
}
