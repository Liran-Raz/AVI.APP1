"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Accessibility,
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
  X,
} from "lucide-react";

import { useT } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import {
  applyPrefs,
  hasAnyPref,
  readPrefs,
  writePrefs,
  TEXT_LEVELS,
  type A11yPrefs,
  type CursorMode,
  type FlagKey,
} from "./a11y-prefs";

// Accessibility widget (DEV-028) — floating button + slide-in "accessibility
// menu" with 9 real adjustments (applied as <html data-a11y-*> → globals.css).
// Mounted ONCE in the root layout so it appears site-wide. Built on Radix
// Dialog: focus trap, focus restore, aria-modal, Escape, scroll-lock — free.
// The widget is itself fully accessible (it IS an accessibility tool).

const OVERLAY_Z = "z-[2147483001]";
const CONTENT_Z = "z-[2147483002]";

export function AccessibilityWidget() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<A11yPrefs>({});
  const wasOpen = useRef(false);

  // Return focus to the FAB after the menu closes (a keyboard user shouldn't be
  // dropped to <body>). Runs in an effect AFTER the close commit, so it beats
  // Radix's own focus cleanup; only fires on a real open→closed transition, so
  // it never steals focus on the initial load.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    const id = window.setTimeout(() => document.getElementById("a11y-fab")?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Hydrate from storage after mount. The inline no-flash script (root layout)
  // has already applied the attributes to <html>; here we only sync React state
  // so the toggle "pressed" states render correctly.
  useEffect(() => {
    // Sync with the persisted store on mount. The inline no-flash script has
    // already applied it to <html>; re-apply defensively in case the script
    // was blocked. External-state sync — the locale/marketing providers do the
    // same on mount.
    const stored = readPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(stored);
    applyPrefs(stored);
  }, []);

  // Functional updater: computes the next prefs from the LATEST state (never a
  // stale closure), then applies + persists. applyPrefs/writePrefs are
  // idempotent (setAttribute / localStorage), so React's dev double-invoke is
  // harmless.
  const mutate = useCallback((fn: (prev: A11yPrefs) => A11yPrefs) => {
    setPrefs((prev) => {
      const next = fn(prev);
      applyPrefs(next);
      writePrefs(next);
      return next;
    });
  }, []);

  const cycleText = useCallback(
    () =>
      mutate((prev) => {
        const order: Array<A11yPrefs["text"]> = [undefined, ...TEXT_LEVELS];
        const nextText = order[(order.indexOf(prev.text) + 1) % order.length];
        const next = { ...prev };
        if (nextText) next.text = nextText;
        else delete next.text;
        return next;
      }),
    [mutate],
  );

  const toggleFlag = useCallback(
    (k: FlagKey) =>
      mutate((prev) => {
        const next = { ...prev };
        if (next[k]) delete next[k];
        else next[k] = true;
        return next;
      }),
    [mutate],
  );

  const setCursor = useCallback(
    (mode: CursorMode) =>
      mutate((prev) => {
        const next = { ...prev };
        if (next.cursor === mode) delete next.cursor;
        else next.cursor = mode;
        return next;
      }),
    [mutate],
  );

  const reset = useCallback(() => mutate(() => ({})), [mutate]);

  // Alt+A toggles the menu, from anywhere. Modifier combo, so it's safe to bind
  // globally even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyA") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const textLevel = prefs.text ? TEXT_LEVELS.indexOf(prefs.text) + 1 : 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          id="a11y-fab"
          type="button"
          aria-label={t("a11y.open")}
          className={cn(
            "fixed bottom-6 right-6 z-[2147483000] grid size-14 place-items-center rounded-full",
            "bg-[#0d1c32] text-white shadow-[0_8px_24px_rgba(13,28,50,0.35)]",
            "transition-transform hover:scale-105",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7cb0ff] focus-visible:ring-offset-2",
          )}
        >
          <Accessibility className="size-7" aria-hidden />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 bg-black/45",
            OVERLAY_Z,
            // Enter-only animation. NO exit animation: Radix Presence gates
            // UNMOUNT on the exit animation's animationend — and the "stop
            // animations" adjustment (html[data-a11y-motion]) kills all
            // animations, so an exit animation would never end → the dialog
            // would stay mounted and trap focus. Closing instantly avoids that.
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          dir="rtl"
          className={cn(
            "fixed inset-y-0 right-0 flex w-[min(400px,92vw)] flex-col bg-[#0f1f38] text-[#eaf0fb] shadow-2xl outline-none",
            CONTENT_Z,
            // Enter-only (see the Overlay note) — instant, robust close.
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right",
          )}
        >
          <DialogPrimitive.Description className="sr-only">
            {t("a11y.description")}
          </DialogPrimitive.Description>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <DialogPrimitive.Title className="flex items-center gap-2.5 text-lg font-bold">
              <Accessibility className="size-6 text-[#7cb0ff]" aria-hidden />
              {t("a11y.title")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t("common.close")}
              className="rounded-md p-1.5 text-2xl leading-none text-[#eaf0fb] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7cb0ff]"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          {/* 3×3 grid of adjustments */}
          <div className="grid flex-1 grid-cols-3 content-start gap-3 overflow-y-auto p-4">
            <Opt
              icon={Type}
              label={t("a11y.text")}
              pressed={!!prefs.text}
              level={textLevel ? t("a11y.textLevel", { n: textLevel }) : undefined}
              onClick={cycleText}
            />
            <Opt icon={Contrast} label={t("a11y.contrast")} pressed={!!prefs.contrast} onClick={() => toggleFlag("contrast")} />
            <Opt icon={Link2} label={t("a11y.links")} pressed={!!prefs.links} onClick={() => toggleFlag("links")} />
            <Opt icon={Heading} label={t("a11y.headings")} pressed={!!prefs.headings} onClick={() => toggleFlag("headings")} />
            <Opt icon={CaseSensitive} label={t("a11y.font")} pressed={!!prefs.font} onClick={() => toggleFlag("font")} />
            <Opt icon={AlignJustify} label={t("a11y.spacing")} pressed={!!prefs.spacing} onClick={() => toggleFlag("spacing")} />
            <Opt icon={Pause} label={t("a11y.motion")} pressed={!!prefs.motion} onClick={() => toggleFlag("motion")} />
            <Opt icon={MousePointerClick} label={t("a11y.cursorBig")} pressed={prefs.cursor === "big"} onClick={() => setCursor("big")} />
            <Opt icon={MousePointer2} label={t("a11y.cursorBlack")} pressed={prefs.cursor === "black"} onClick={() => setCursor("black")} />
          </div>

          {/* Footer */}
          <div className="border-t border-white/10 px-5 py-4 text-center">
            <button
              type="button"
              onClick={reset}
              disabled={!hasAnyPref(prefs)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-[#ff8b93] hover:bg-white/5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#ff8b93]"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("a11y.reset")}
            </button>
            <p className="mt-2 text-xs text-[#9fb0cc]">{t("a11y.shortcut")}</p>
            <Link
              href="/accessibility"
              className="mt-1 inline-block text-sm text-[#7cb0ff] underline underline-offset-2 hover:text-[#a7c9ff]"
            >
              {t("a11y.statement")}
            </Link>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Opt({
  icon: Icon,
  label,
  pressed,
  level,
  onClick,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  pressed: boolean;
  level?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-2xl border-2 border-transparent bg-[#172b49] px-2 py-4 text-center text-[13px] font-semibold text-[#eaf0fb]",
        "transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#7cb0ff]",
        pressed && "border-[#7cb0ff] bg-[#1f3d6b]",
      )}
    >
      <Icon className="size-7 text-[#cfe0ff]" aria-hidden />
      <span>{label}</span>
      {level ? <span className="text-[11px] font-bold text-[#7cb0ff]">{level}</span> : null}
    </button>
  );
}
