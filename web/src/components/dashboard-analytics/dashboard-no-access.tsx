"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/locale-provider";

// Shown when a signed-in member without dashboard access lands on /dashboard
// (Stage 13 R4). A friendly "no permission" screen — NOT a 404 — so the user
// understands the page exists but is owner-gated. The owner can grant access
// from the "צוות" screen.
export function DashboardNoAccess() {
  const t = useT();
  return (
    <div className="p-6 md:p-10 flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md text-center rounded-lg border border-border glass-card shadow-card p-8">
        <div className="size-14 mx-auto rounded-full bg-[var(--priority-urgent)]/10 text-[var(--priority-urgent)] flex items-center justify-center mb-4">
          <ShieldAlert className="size-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">
          {t("dashboard.noAccess.title")}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {t("dashboard.noAccess.body")}
        </p>
        <Button asChild variant="outline">
          <Link href="/tasks">{t("dashboard.noAccess.back")}</Link>
        </Button>
      </div>
    </div>
  );
}
