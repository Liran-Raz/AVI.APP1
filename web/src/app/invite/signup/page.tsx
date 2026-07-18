import Link from "next/link";
import { headers } from "next/headers";

import { InviteSignupForm } from "./invite-signup-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AppError } from "@/server/errors/app-error";
import * as teamService from "@/server/services/team.service";
import { checkRateLimit, clientIp } from "@/server/security/rate-limit";
import { getServerT } from "@/i18n/server";
import { readLocale } from "@/server/i18n/locale-cookie";

// Public — dedicated signup form for invited users. We deliberately do
// NOT reuse /signup because:
//   • email is derived from the invitation (not user-typed)
//   • orgName/orgCode are not collected (the org already exists)
//   • emailRedirectTo must point to /invite/accept after confirmation
//
// We render the form only if the invitation is in a valid pending state.

type SearchParams = Promise<{ token?: string }>;

export default async function InviteSignupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token } = await searchParams;
  const t = await getServerT(await readLocale());

  if (!token) {
    return (
      <Shell>
        <ErrorCard
          title={t("invite.errInvalidLinkTitle")}
          message={t("invite.signupErrInvalidLinkMsg")}
          backLabel={t("invite.backToLogin")}
        />
      </Shell>
    );
  }

  // Throttle anonymous preview probing per IP (skips the preview RPC when
  // tripped). A legitimate invitee loads this page only a few times.
  const previewLimit = await checkRateLimit(
    "invite-preview:ip",
    clientIp(await headers()),
    30,
    "10 m",
  );
  if (!previewLimit.allowed) {
    return (
      <Shell>
        <ErrorCard
          title={t("invite.errTooManyRequestsTitle")}
          message={t("invite.errTooManyRequestsMsg")}
          backLabel={t("invite.backToLogin")}
        />
      </Shell>
    );
  }

  let preview;
  try {
    preview = await teamService.previewInvitation(token);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      return (
        <Shell>
          <ErrorCard
            title={t("invite.errNotFoundTitle")}
            message={t("invite.signupErrNotFoundMsg")}
            backLabel={t("invite.backToLogin")}
          />
        </Shell>
      );
    }
    throw err;
  }

  if (preview.status !== "pending") {
    return (
      <Shell>
        <ErrorCard
          title={t("invite.errInactiveTitle")}
          message={t("invite.signupErrInactiveMsg")}
          backLabel={t("invite.backToLogin")}
        />
      </Shell>
    );
  }
  if (new Date(preview.expiresAt) < new Date()) {
    return (
      <Shell>
        <ErrorCard
          title={t("invite.errExpiredTitle")}
          message={t("invite.errExpiredMsg")}
          backLabel={t("invite.backToLogin")}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-2xl">
            {t("invite.signupJoinTitle", { orgName: preview.orgName })}
          </CardTitle>
          <CardDescription>
            {t("invite.signupCreateAccountWith")}
            <span dir="ltr" className="font-mono">
              {preview.email}
            </span>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteSignupForm token={token} email={preview.email} />
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        {t("invite.alreadyHaveAccountQ")}{" "}
        <Link
          href={`/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
          className="text-primary hover:underline font-medium"
        >
          {t("invite.loginInstead")}
        </Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 bg-muted/30">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="size-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
              א
            </div>
            <span className="font-bold text-xl">AVI.APP</span>
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorCard({
  title,
  message,
  backLabel,
}: {
  title: string;
  message: string;
  backLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="text-center space-y-2">
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/login"
          className="inline-flex items-center justify-center w-full h-11 rounded-md border border-border bg-background font-medium hover:bg-muted/50"
        >
          {backLabel}
        </Link>
      </CardContent>
    </Card>
  );
}
