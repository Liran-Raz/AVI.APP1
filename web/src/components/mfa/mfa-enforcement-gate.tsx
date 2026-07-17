"use client";

import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

// HARD office-wide 2FA enforcement (DEV-013). When the office requires 2FA
// and the signed-in member hasn't set it up, the ONLY reachable page is
// Settings (where they enroll) — every other dashboard page renders this
// block instead of its content. The app chrome (nav) stays visible so the
// member can still reach Settings from it; once they enroll, the layout
// re-renders with required=false and the whole app opens back up.
//
// Wraps the layout's children (server-rendered) and conditionally renders
// them. Not middleware — so the sensitive proxy/middleware stays untouched.
export function MfaEnforcementGate({
  required,
  children,
}: {
  required: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Settings is the escape/enroll surface — always let it through (the
  // office-policy toggle also lives there, so an owner can never lock
  // themselves out). Everything else is blocked while required.
  const onSettings = pathname.startsWith("/settings");
  if (!required || onSettings) return <>{children}</>;

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-md border border-border rounded-lg glass-card shadow-card p-8 text-center space-y-4">
        <div className="flex justify-center">
          <ShieldAlert className="size-10 text-amber-500" />
        </div>
        <h2 className="text-xl font-bold">נדרש אימות דו-שלבי</h2>
        <p className="text-sm text-muted-foreground">
          בעל המשרד הגדיר אימות דו-שלבי (2FA) כחובה עבור כל חברי הצוות.
          כדי להמשיך להשתמש במערכת יש להגדיר אותו. ההגדרה אורכת כדקה: סורקים
          קוד QR עם אפליקציית אימות בטלפון ומזינים קוד חד-פעמי.
        </p>
        <Button onClick={() => router.push("/settings?tab=security")}>
          להגדרת האימות הדו-שלבי
        </Button>
      </div>
    </div>
  );
}
