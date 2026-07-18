"use client";

import type { ComponentType } from "react";
import {
  AlignJustify,
  CaseSensitive,
  Contrast,
  Heading,
  Link2,
  MousePointer2,
  MousePointerClick,
  Pause,
  RotateCcw,
  Type,
} from "lucide-react";

import { useT } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { hasAnyPref } from "./a11y-prefs";
import { useA11yPrefs } from "./use-a11y-prefs";

// The 9-adjustment grid + reset — shared by the floating widget (tone="dark",
// on the navy panel) and the Settings → Accessibility tab (tone="light", on the
// app's light surfaces). Logic/state come from useA11yPrefs, so both stay in
// sync via localStorage + the <html> data-attributes.

type Tone = "dark" | "light";

const TONE: Record<
  Tone,
  { card: string; active: string; icon: string; ring: string; level: string; reset: string }
> = {
  dark: {
    card: "bg-[#172b49] text-[#eaf0fb]",
    active: "border-[#7cb0ff] bg-[#1f3d6b]",
    icon: "text-[#cfe0ff]",
    ring: "focus-visible:ring-[#7cb0ff]",
    level: "text-[#7cb0ff]",
    reset: "text-[#ff8b93] hover:bg-white/5 focus-visible:ring-[#ff8b93]",
  },
  light: {
    card: "bg-secondary text-foreground",
    active: "border-primary bg-primary/10",
    icon: "text-primary",
    ring: "focus-visible:ring-ring",
    level: "text-primary",
    reset: "text-destructive hover:bg-destructive/5 focus-visible:ring-destructive",
  },
};

export function AccessibilityControls({ tone }: { tone: Tone }) {
  const t = useT();
  const { prefs, cycleText, toggleFlag, setCursor, reset, textLevel } = useA11yPrefs();
  const c = TONE[tone];

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Opt
          tone={tone}
          icon={Type}
          label={t("a11y.text")}
          pressed={!!prefs.text}
          level={textLevel ? t("a11y.textLevel", { n: textLevel }) : undefined}
          onClick={cycleText}
        />
        <Opt tone={tone} icon={Contrast} label={t("a11y.contrast")} pressed={!!prefs.contrast} onClick={() => toggleFlag("contrast")} />
        <Opt tone={tone} icon={Link2} label={t("a11y.links")} pressed={!!prefs.links} onClick={() => toggleFlag("links")} />
        <Opt tone={tone} icon={Heading} label={t("a11y.headings")} pressed={!!prefs.headings} onClick={() => toggleFlag("headings")} />
        <Opt tone={tone} icon={CaseSensitive} label={t("a11y.font")} pressed={!!prefs.font} onClick={() => toggleFlag("font")} />
        <Opt tone={tone} icon={AlignJustify} label={t("a11y.spacing")} pressed={!!prefs.spacing} onClick={() => toggleFlag("spacing")} />
        <Opt tone={tone} icon={Pause} label={t("a11y.motion")} pressed={!!prefs.motion} onClick={() => toggleFlag("motion")} />
        <Opt tone={tone} icon={MousePointerClick} label={t("a11y.cursorBig")} pressed={prefs.cursor === "big"} onClick={() => setCursor("big")} />
        <Opt tone={tone} icon={MousePointer2} label={t("a11y.cursorBlack")} pressed={prefs.cursor === "black"} onClick={() => setCursor("black")} />
      </div>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={reset}
          disabled={!hasAnyPref(prefs)}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px]",
            c.reset,
          )}
        >
          <RotateCcw className="size-4" aria-hidden />
          {t("a11y.reset")}
        </button>
      </div>
    </div>
  );
}

function Opt({
  tone,
  icon: Icon,
  label,
  pressed,
  level,
  onClick,
}: {
  tone: Tone;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  pressed: boolean;
  level?: string;
  onClick: () => void;
}) {
  const c = TONE[tone];
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-2xl border-2 border-transparent px-2 py-4 text-center text-[13px] font-semibold",
        "transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px]",
        c.card,
        c.ring,
        pressed && c.active,
      )}
    >
      <Icon className={cn("size-7", c.icon)} aria-hidden />
      <span>{label}</span>
      {level ? <span className={cn("text-[11px] font-bold", c.level)}>{level}</span> : null}
    </button>
  );
}
