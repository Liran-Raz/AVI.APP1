"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

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

  // If signup metadata is complete, try to bootstrap automatically.
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
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("bootstrap_org", {
        p_org_name: name,
        p_org_code: code,
        p_full_name: fname,
      });
      if (error) {
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

  // While auto-bootstrap is in flight, show a friendly loading state.
  if (canAutoBootstrap && submitting) {
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
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground" dir="ltr">
                {email}
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
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
