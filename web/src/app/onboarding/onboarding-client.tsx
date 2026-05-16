"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type RpcError = { code?: string; message?: string; details?: string };

export function OnboardingClient({
  email,
  initialOrgName,
  initialOrgCode,
  initialFullName,
}: {
  email: string;
  initialOrgName: string;
  initialOrgCode: string;
  initialFullName: string;
}) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(initialOrgName);
  const [orgCode, setOrgCode] = useState(initialOrgCode);
  const [fullName, setFullName] = useState(initialFullName);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<RpcError | null>(null);

  const autoRanRef = useRef(false);
  const canAutoBootstrap =
    initialOrgName && /^[A-Z0-9-]{3,20}$/.test(initialOrgCode) && initialFullName;

  useEffect(() => {
    if (!canAutoBootstrap || autoRanRef.current) return;
    autoRanRef.current = true;
    void bootstrap(initialOrgName, initialOrgCode, initialFullName, /*silent*/ true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap(
    name: string,
    code: string,
    fname: string,
    silent = false,
  ) {
    setSubmitting(true);
    setLastError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("bootstrap_org", {
        p_org_name: name,
        p_org_code: code,
        p_full_name: fname,
      });
      if (error) {
        setLastError({
          code: error.code,
          message: error.message,
          details: error.details ?? undefined,
        });
        if (!silent) toast.error(`שגיאה: ${error.message}`);
        console.error("bootstrap_org error", error);
        return;
      }
      console.log("bootstrap_org success", data);
      toast.success("המשרד הוקם — מעביר אותך לתור המשימות");
      router.push("/tasks");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await bootstrap(orgName, orgCode, fullName);
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const dbNotReady =
    lastError?.code === "PGRST202" || lastError?.code === "PGRST205";

  if (canAutoBootstrap && submitting && !lastError) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12 bg-muted/30">
        <div className="text-center space-y-3">
          <Loader2 className="size-8 mx-auto animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">מקים את המשרד שלך...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 bg-muted/30">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2">
            <div className="size-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
              א
            </div>
            <span className="font-bold text-xl">AVI.APP</span>
          </div>
        </div>

        {dbNotReady && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <CardTitle className="text-base text-destructive">
                    מסד הנתונים עדיין לא הוקם
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    PostgREST מחזיר {lastError?.code} — הפונקציה/הטבלאות לא קיימות ב-Supabase.
                    צריך להריץ את `supabase/APPLY_ALL.sql` ב-SQL Editor פעם אחת.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">בואו נסיים את ההקמה</CardTitle>
            <CardDescription>
              חסר לנו עוד פרט אחד או שניים על המשרד שלך, ואנחנו בפנים.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                <span className="text-muted-foreground" dir="ltr">
                  {email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <LogOut className="size-3" />
                  התחבר כמשתמש אחר
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fullName">שמך המלא</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgName">שם המשרד</Label>
                <Input
                  id="orgName"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="ראיית חשבון..."
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgCode">קוד משרד (אנגלית, אותיות גדולות)</Label>
                <Input
                  id="orgCode"
                  value={orgCode}
                  onChange={(e) => setOrgCode(e.target.value.toUpperCase())}
                  pattern="[A-Z0-9-]{3,20}"
                  dir="ltr"
                  className="text-start uppercase font-mono"
                  required
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={submitting}>
                {submitting ? "מקים..." : "סיים והכנס למשרד"}
              </Button>

              {lastError && !dbNotReady && (
                <p className="text-xs text-destructive text-center">
                  {lastError.message}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
