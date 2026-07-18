"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

type Props = {
  token: string;
  email: string;
};

export function InviteSignupForm({ token, email }: Props) {
  const t = useT();
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
        toast.success(t("invite.signupConfirmToast"));
        // Email-confirmation flow: link in the email points to
        // /auth/confirm?next=/invite/accept?token=... — invitee will
        // land on the accept page after clicking.
        router.push(`/login?pending=${encodeURIComponent(result.email)}`);
      } else {
        // Direct-session flow (rare in our setup; email confirmation is ON).
        toast.success(t("invite.signupCreatedToast"));
        router.push(`/invite/accept?token=${encodeURIComponent(token)}`);
      }
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="invitedEmail">{t("common.email")}</Label>
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
          {t("invite.signupEmailLocked")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">{t("common.fullName")}</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t("invite.signupNamePlaceholder")}
          required
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t("invite.passwordLabel")}</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">{t("invite.passwordHint")}</p>
      </div>

      <Button type="submit" className="w-full h-11" disabled={loading}>
        {loading ? t("invite.signupSubmitting") : t("invite.signupSubmit")}
      </Button>
    </form>
  );
}
