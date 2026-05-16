"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    orgName: "",
    orgCode: "",
    fullName: "",
    email: "",
    password: "",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();

      // 1) Create auth user
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            full_name: form.fullName,
            org_name: form.orgName,
            org_code: form.orgCode,
          },
        },
      });

      if (signUpError) {
        toast.error(signUpError.message || "הרשמה נכשלה");
        return;
      }

      // The org + profile rows are created by a server-side handler after signup
      // (or by a database trigger — to be wired up after migrations run).
      toast.success("המשרד נפתח! שולח אותך לתור המשימות.");
      router.push("/tasks");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("שגיאה לא צפויה. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="orgName">שם המשרד</Label>
          <Input
            id="orgName"
            value={form.orgName}
            onChange={(e) => update("orgName", e.target.value)}
            placeholder="ראיית חשבון אבי"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="orgCode">קוד משרד</Label>
          <Input
            id="orgCode"
            value={form.orgCode}
            onChange={(e) => update("orgCode", e.target.value.toUpperCase())}
            placeholder="AVI"
            pattern="[A-Z0-9-]{3,20}"
            dir="ltr"
            className="text-start uppercase"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">שמך המלא</Label>
        <Input
          id="fullName"
          value={form.fullName}
          onChange={(e) => update("fullName", e.target.value)}
          placeholder="אבי כהן"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">אימייל</Label>
        <Input
          id="email"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="avi@example.com"
          dir="ltr"
          className="text-start"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">סיסמה</Label>
        <Input
          id="password"
          type="password"
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">לפחות 8 תווים</p>
      </div>

      <Button type="submit" className="w-full h-11" disabled={loading}>
        {loading ? "פותח משרד..." : "פתיחת משרד"}
      </Button>
    </form>
  );
}
