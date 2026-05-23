"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";

type Props = {
  token: string;
  email: string;
};

export function InviteSignupForm({ token, email }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await apiClient.invite.signup({
        token,
        password,
        fullName,
      });
      if (result.needsEmailConfirmation) {
        toast.success(
          "שלחנו לך מייל אישור. לחץ על הלינק במייל כדי לסיים את ההצטרפות.",
        );
        // Email-confirmation flow: link in the email points to
        // /auth/confirm?next=/invite/accept?token=... — invitee will
        // land on the accept page after clicking.
        router.push(`/login?pending=${encodeURIComponent(result.email)}`);
      } else {
        // Direct-session flow (rare in our setup; email confirmation is ON).
        toast.success("החשבון נוצר. ממשיך לאשר את ההזמנה...");
        router.push(`/invite/accept?token=${encodeURIComponent(token)}`);
      }
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="invitedEmail">אימייל</Label>
        <Input
          id="invitedEmail"
          type="email"
          value={email}
          readOnly
          disabled
          dir="ltr"
          className="text-start font-mono bg-muted/50"
        />
        <p className="text-xs text-muted-foreground">
          האימייל קבוע לפי ההזמנה ולא ניתן לשינוי.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">שמך המלא</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="ישראל ישראלי"
          required
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">סיסמה</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">לפחות 8 תווים</p>
      </div>

      <Button type="submit" className="w-full h-11" disabled={loading}>
        {loading ? "יוצר חשבון..." : "צור חשבון והצטרף"}
      </Button>
    </form>
  );
}
