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

  if (!token) {
    return (
      <InvitationShell>
        <ErrorState
          title="קישור לא תקין"
          message="חסר token בכתובת ההזמנה. ודא שהעתקת את כל הקישור מהמייל."
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
        <ErrorState title="יותר מדי בקשות" message="נסה שוב בעוד כמה דקות." />
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
            title="הזמנה לא נמצאה"
            message="הקישור שגוי או שההזמנה כבר נמחקה. בקש מהמנהל לשלוח לך הזמנה חדשה."
          />
        </InvitationShell>
      );
    }
    throw err;
  }

  if (preview.status !== "pending") {
    const messages: Record<string, string> = {
      accepted: "ההזמנה כבר אושרה. נסה להתחבר עם החשבון שלך.",
      expired: "ההזמנה פגה. בקש מהמנהל לשלוח לך הזמנה חדשה.",
      revoked: "ההזמנה בוטלה ע״י המנהל.",
    };
    return (
      <InvitationShell>
        <ErrorState
          title="הזמנה לא פעילה"
          message={messages[preview.status] ?? "ההזמנה לא פעילה."}
        />
      </InvitationShell>
    );
  }

  const expired = new Date(preview.expiresAt) < new Date();
  if (expired) {
    return (
      <InvitationShell>
        <ErrorState
          title="ההזמנה פגה"
          message="בקש מהמנהל לשלוח לך הזמנה חדשה."
        />
      </InvitationShell>
    );
  }

  const ROLE_LABEL: Record<"admin" | "employee", string> = {
    admin: "מנהל",
    employee: "עובד",
  };
  const roleHe = ROLE_LABEL[preview.role as "admin" | "employee"] ?? preview.role;

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
            <CardTitle className="text-2xl">הוזמנת ל-{preview.orgName}</CardTitle>
            <CardDescription>
              הוזמנת להצטרף כ-{roleHe} עם האימייל{" "}
              <span dir="ltr" className="font-mono">
                {preview.email}
              </span>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              כדי לאשר את ההזמנה, היכנס עם החשבון שלך — או צור חשבון חדש.
            </p>
            <Link href={signupHref} className="block">
              <span className="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90">
                צור חשבון חדש
              </span>
            </Link>
            <Link href={loginHref} className="block">
              <span className="inline-flex items-center justify-center w-full h-11 rounded-md border border-border bg-background font-medium hover:bg-muted/50">
                כבר יש לי חשבון — התחבר
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
          <CardTitle className="text-2xl">הוזמנת ל-{preview.orgName}</CardTitle>
          <CardDescription>
            הוזמנת להצטרף כ-{roleHe}. לחץ &quot;אשר הזמנה&quot; כדי להצטרף עכשיו.
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

function ErrorState({ title, message }: { title: string; message: string }) {
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
          חזרה להתחברות
        </Link>
      </CardContent>
    </Card>
  );
}
