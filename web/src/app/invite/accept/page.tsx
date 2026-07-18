import Link from "next/link";
import { headers } from "next/headers";

import { AcceptClient } from "./accept-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentSession } from "@/server/auth/session";
import { AppError } from "@/server/errors/app-error";
import * as teamService from "@/server/services/team.service";
import { checkRateLimit, clientIp } from "@/server/security/rate-limit";
import { getServerT } from "@/i18n/server";
import { readLocale } from "@/server/i18n/locale-cookie";
import type { MessageKey } from "@/i18n/messages-types";

// Public page — middleware does NOT include /invite/accept in
// PROTECTED_PREFIXES. The actual gate is application-level:
//   • For accepting the invitation, the API requires a session
//     (POST /api/invite/accept calls requireUser).
//   • For preview, the server-side render below uses the unauthenticated
//     supabase client to look up the invitation by token hash.
//
// The page renders one of three states:
//   1. Invalid / expired / accepted invitation → error card
//   2. Valid + user NOT logged in → two-button card (log in / sign up)
//   3. Valid + user logged in → AcceptClient calls accept, redirects

type SearchParams = Promise<{ token?: string }>;

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token } = await searchParams;
  const t = await getServerT(await readLocale());

  if (!token) {
    return (
      <InvitationShell>
        <ErrorState
          title={t("invite.errInvalidLinkTitle")}
          message={t("invite.acceptErrInvalidLinkMsg")}
          backLabel={t("invite.backToLogin")}
        />
      </InvitationShell>
    );
  }

  // Throttle anonymous preview probing per IP (a legitimate accept loads
  // this page only a handful of times, well under the limit). When tripped
  // we skip the preview RPC entirely.
  const previewLimit = await checkRateLimit(
    "invite-preview:ip",
    clientIp(await headers()),
    30,
    "10 m",
  );
  if (!previewLimit.allowed) {
    return (
      <InvitationShell>
        <ErrorState
          title={t("invite.errTooManyRequestsTitle")}
          message={t("invite.errTooManyRequestsMsg")}
          backLabel={t("invite.backToLogin")}
        />
      </InvitationShell>
    );
  }

  // Try to preview the invitation (no session required).
  let preview;
  try {
    preview = await teamService.previewInvitation(token);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      return (
        <InvitationShell>
          <ErrorState
            title={t("invite.errNotFoundTitle")}
            message={t("invite.acceptErrNotFoundMsg")}
            backLabel={t("invite.backToLogin")}
          />
        </InvitationShell>
      );
    }
    throw err;
  }

  if (preview.status !== "pending") {
    const statusKey: Record<string, MessageKey> = {
      accepted: "invite.statusAccepted",
      expired: "invite.statusExpired",
      revoked: "invite.statusRevoked",
    };
    return (
      <InvitationShell>
        <ErrorState
          title={t("invite.errInactiveTitle")}
          message={t(statusKey[preview.status] ?? "invite.statusInactiveFallback")}
          backLabel={t("invite.backToLogin")}
        />
      </InvitationShell>
    );
  }

  const expired = new Date(preview.expiresAt) < new Date();
  if (expired) {
    return (
      <InvitationShell>
        <ErrorState
          title={t("invite.errExpiredTitle")}
          message={t("invite.errExpiredMsg")}
          backLabel={t("invite.backToLogin")}
        />
      </InvitationShell>
    );
  }

  const roleLabel =
    preview.role === "admin" || preview.role === "employee"
      ? t(`role.${preview.role}` as MessageKey)
      : preview.role;

  // Are they already logged in?
  const session = await getCurrentSession();

  if (!session) {
    // Logged-out path: offer two options.
    const acceptUrl = `/invite/accept?token=${encodeURIComponent(token)}`;
    const loginHref = `/login?redirect=${encodeURIComponent(acceptUrl)}`;
    const signupHref = `/invite/signup?token=${encodeURIComponent(token)}`;
    return (
      <InvitationShell>
        <Card>
          <CardHeader className="text-center space-y-2">
            <CardTitle className="text-2xl">
              {t("invite.invitedToOrg", { orgName: preview.orgName })}
            </CardTitle>
            <CardDescription>
              {t("invite.invitedAsRoleWithEmail", { role: roleLabel })}
              <span dir="ltr" className="font-mono">
                {preview.email}
              </span>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("invite.loginOrSignupPrompt")}
            </p>
            <Link href={signupHref} className="block">
              <span className="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90">
                {t("invite.createAccount")}
              </span>
            </Link>
            <Link href={loginHref} className="block">
              <span className="inline-flex items-center justify-center w-full h-11 rounded-md border border-border bg-background font-medium hover:bg-muted/50">
                {t("invite.alreadyHaveAccount")}
              </span>
            </Link>
          </CardContent>
        </Card>
      </InvitationShell>
    );
  }

  // Logged-in path: hand off to client component for the accept call.
  // If the user already has a profile, the accept API will return a
  // clean error (CONFLICT) and AcceptClient surfaces it.
  return (
    <InvitationShell>
      <Card>
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-2xl">
            {t("invite.invitedToOrg", { orgName: preview.orgName })}
          </CardTitle>
          <CardDescription>
            {t("invite.invitedAsRolePrompt", { role: roleLabel })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptClient
            token={token}
            invitedEmail={preview.email}
            currentUserEmail={session.user.email ?? ""}
            hasExistingProfile={!!session.profile}
          />
        </CardContent>
      </Card>
    </InvitationShell>
  );
}

function InvitationShell({ children }: { children: React.ReactNode }) {
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

function ErrorState({
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
