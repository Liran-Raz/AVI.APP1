"use client";

import Link from "next/link";
import { Accessibility } from "lucide-react";

import { useT } from "@/i18n/locale-provider";
import { AccessibilityControls } from "./accessibility-controls";

// Settings → Accessibility tab (DEV-028). The in-app home for the display
// adjustments (the floating widget is public-pages only). Reuses the exact same
// controls + state as the widget, so a choice made here or there is one and the
// same (persisted per device).
export function AccessibilitySettings() {
  const t = useT();
  return (
    <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Accessibility className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">{t("a11y.settings.title")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("a11y.settings.subtitle")}
          </p>
        </div>
      </div>

      <AccessibilityControls tone="light" />

      <p className="text-center text-sm">
        <Link
          href="/accessibility"
          className="text-primary hover:underline underline-offset-2"
        >
          {t("a11y.statement")}
        </Link>
      </p>
    </div>
  );
}
