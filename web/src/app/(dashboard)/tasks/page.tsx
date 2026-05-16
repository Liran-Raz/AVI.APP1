import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/server/auth/session";

export default async function TasksPage() {
  // (dashboard)/layout already enforces this — these guards are defense in
  // depth and also narrow types for the JSX below.
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">תור משימות</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ממוין לפי זמן ביצוע — הקרוב ביותר למעלה
          </p>
        </div>
        <Button>משימה חדשה</Button>
      </div>

      <div className="border border-dashed border-border rounded-lg p-12 text-center bg-card">
        <div className="size-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
          <ListChecks className="size-6" />
        </div>
        <h2 className="font-semibold text-lg mb-2">ברוך הבא, {session.profile.full_name}!</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
          המשרד שלך &quot;{session.organization.name}&quot; מוכן. כשתיצור את המשימה הראשונה היא תופיע כאן.
        </p>
        <Button>צור משימה ראשונה</Button>
      </div>
    </div>
  );
}
