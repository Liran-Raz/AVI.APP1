"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Accessibility, X } from "lucide-react";

import { useT } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { AccessibilityControls } from "./accessibility-controls";

// Floating accessibility widget (DEV-028) — button + slide-in menu, shown ONLY
// on PUBLIC pages (landing + auth + onboarding/invite), where there is no
// Settings screen. Inside the authenticated app the same adjustments live in
// Settings → Accessibility, so no floating button clutters the app chrome.
// Mounted once in the root layout; the pathname gate below hides it in-app.
//
// Built on Radix Dialog: focus trap, aria-modal (via aria-hidden siblings),
// Escape, scroll-lock. Adjustment state/logic live in AccessibilityControls.

// Public route prefixes that SHOW the floating button. Anything else (the
// authenticated app) hides it — a safe default: a new app screen won't
// accidentally show the FAB; only a new PUBLIC page needs adding here.
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/mfa",
  "/forgot-password",
  "/reset-password",
  "/accessibility",
  "/privacy",
  "/terms",
  "/onboarding",
  "/invite",
];

const OVERLAY_Z = "z-[2147483001]";
const CONTENT_Z = "z-[2147483002]";

export function AccessibilityWidget() {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wasOpen = useRef(false);

  // Return focus to the FAB after the menu closes (a keyboard user shouldn't be
  // dropped to <body>). Runs in an effect AFTER the close commit, so it beats
  // Radix's own focus cleanup; only fires on a real open→closed transition.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    const id = window.setTimeout(() => document.getElementById("a11y-fab")?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Alt+A toggles the menu. Modifier combo, safe to bind globally.
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

  // In-app (any non-public route) → no floating button; Settings hosts it.
  const isPublic =
    pathname === "/" ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic) return null;

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
            // animations" adjustment kills all animations, so an exit animation
            // would never end → the dialog would stay mounted and trap focus.
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          dir="rtl"
          className={cn(
            "fixed inset-y-0 right-0 flex w-[min(400px,92vw)] flex-col bg-[#0f1f38] text-[#eaf0fb] shadow-2xl outline-none",
            CONTENT_Z,
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right",
          )}
        >
          <DialogPrimitive.Description className="sr-only">
            {t("a11y.description")}
          </DialogPrimitive.Description>

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

          <div className="flex-1 overflow-y-auto p-4">
            <AccessibilityControls tone="dark" />
          </div>

          <div className="border-t border-white/10 px-5 py-4 text-center">
            <p className="text-xs text-[#9fb0cc]">{t("a11y.shortcut")}</p>
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
