import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

// Shown when a signed-in member without dashboard access lands on /dashboard
// (Stage 13 R4). A friendly Hebrew "no permission" screen — NOT a 404 — so the
// user understands the page exists but is owner-gated. The owner can grant
// access from the "צוות" screen.
export function DashboardNoAccess() {
  return (
    <div className="p-6 md:p-10 flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md text-center rounded-lg border border-border glass-card shadow-card p-8">
        <div className="size-14 mx-auto rounded-full bg-[var(--priority-urgent)]/10 text-[var(--priority-urgent)] flex items-center justify-center mb-4">
          <ShieldAlert className="size-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">
          אין לך הרשאה לצפות בדשבורד
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          הדשבורד הניהולי פתוח לבעל המשרד ולחברי צוות שהבעלים העניק להם גישה.
          אם לדעתך צריכה להיות לך גישה — פנה/י לבעל המשרד.
        </p>
        <Button asChild variant="outline">
          <Link href="/tasks">חזרה לתור המשימות</Link>
        </Button>
      </div>
    </div>
  );
}
