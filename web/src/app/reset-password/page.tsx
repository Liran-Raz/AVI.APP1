import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/server/auth/session";
import { ResetPasswordForm } from "./reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getServerT } from "@/i18n/server";
import { readLocale } from "@/server/i18n/locale-cookie";

// Public page — middleware does NOT protect /reset-password. The
// actual gate is server-side: POST /api/auth/reset-password calls
// requireUser() and returns 401 if no recovery session exists. The
// page itself can render either way; if the user lands here without a
// session, the form will simply fail on submit and they can request
// a new reset link.
//
// DEV-013: for a 2FA-enrolled user the recovery-link session is aal1 and
// the provider REFUSES the password update until the TOTP challenge
// passes — so we hop through /mfa first and return here at aal2.
export default async function ResetPasswordPage() {
  const session = await getCurrentSession();
  if (session?.mfaPending) redirect("/mfa?next=/reset-password");
  const t = await getServerT(await readLocale());
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 bg-muted/30">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="size-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
              א
            </div>
            <span className="font-bold text-xl">AVI.APP</span>
          </Link>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t("auth.reset.title")}</CardTitle>
            <CardDescription>{t("auth.reset.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
