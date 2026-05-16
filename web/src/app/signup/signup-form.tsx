"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";

// Key for stashing the org-info portion of signup so /onboarding can
// pre-fill it. The new /api/auth/signup endpoint only accepts identity
// fields (email, password, fullName); org details belong to onboarding.
// Storing them in sessionStorage preserves the existing UX without
// stuffing org data into auth.users metadata.
const PENDING_ONBOARDING_KEY = "avi.pendingOnboarding";

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
      const result = await apiClient.auth.signUp({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
      });

      // Stash org details locally so /onboarding can pre-fill them.
      // Cleared by onboarding once the org is created.
      try {
        sessionStorage.setItem(
          PENDING_ONBOARDING_KEY,
          JSON.stringify({
            orgName: form.orgName,
            orgCode: form.orgCode,
          }),
        );
      } catch {
        // sessionStorage can throw in some private-mode browsers — fine,
        // user will retype on /onboarding.
      }

      if (result.needsEmailConfirmation) {
        toast.success("שלחנו לך אימייל לאישור. לחץ על הלינק כדי להתחיל.");
        router.push(`/login?pending=${encodeURIComponent(form.email)}`);
      } else {
        toast.success("חשבון נפתח! מקים את המשרד...");
        router.push("/onboarding");
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("שגיאה לא צפויה. נסה שוב.");
        console.error(err);
      }
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
