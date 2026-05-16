"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";
import { ORG_CODE_RE } from "@/server/validators/onboarding.schema";

// Must match the constant in signup-form.tsx — kept inline (not exported)
// because this is the only producer/consumer pair and the key is private.
const PENDING_ONBOARDING_KEY = "avi.pendingOnboarding";

type FormError = { code?: string; message: string };

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
  const [lastError, setLastError] = useState<FormError | null>(null);

  // On first mount, recover any org details signup-form stashed for us.
  // We only fill empty fields — props from the server take precedence.
  // sessionStorage is a browser API not available during SSR, so this MUST
  // run in an effect; the eslint rule against setState-in-effect doesn't
  // apply when syncing with non-React external state.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_ONBOARDING_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { orgName?: string; orgCode?: string };
      if (parsed.orgName && !initialOrgName) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrgName(parsed.orgName);
      }
      if (parsed.orgCode && !initialOrgCode) setOrgCode(parsed.orgCode);
    } catch {
      // ignore — user will retype
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoRanRef = useRef(false);
  const canAutoBootstrap =
    initialOrgName && ORG_CODE_RE.test(initialOrgCode) && initialFullName;

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
      await apiClient.onboarding.bootstrap({
        orgName: name,
        orgCode: code,
        fullName: fname,
      });
      // Success — drop any stashed signup hint and head to /tasks.
      try {
        sessionStorage.removeItem(PENDING_ONBOARDING_KEY);
      } catch {
        /* noop */
      }
      toast.success("המשרד הוקם — מעביר אותך לתור המשימות");
      router.push("/tasks");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setLastError({ code: err.code, message: err.message });
        if (!silent) toast.error(`שגיאה: ${err.message}`);
      } else {
        setLastError({ message: "שגיאה לא צפויה" });
        if (!silent) toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await bootstrap(orgName, orgCode, fullName);
  }

  async function handleLogout() {
    try {
      await apiClient.auth.signOut();
    } catch {
      /* best-effort — still navigate away */
    }
    router.push("/login");
    router.refresh();
  }

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

              {lastError && (
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
