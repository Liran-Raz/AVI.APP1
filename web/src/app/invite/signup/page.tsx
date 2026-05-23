import Link from "next/link";

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

  if (!token) {
    return (
      <Shell>
        <ErrorCard
          title="קישור לא תקין"
          message="חסר token. נסה לפתוח את הקישור המלא מהמייל שוב."
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
            title="הזמנה לא נמצאה"
            message="הקישור שגוי או שההזמנה כבר נמחקה."
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
          title="הזמנה לא פעילה"
          message="ההזמנה כבר אושרה, פגה או בוטלה. בקש מהמנהל לשלוח לך הזמנה חדשה."
        />
      </Shell>
    );
  }
  if (new Date(preview.expiresAt) < new Date()) {
    return (
      <Shell>
        <ErrorCard
          title="ההזמנה פגה"
          message="בקש מהמנהל לשלוח לך הזמנה חדשה."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-2xl">הצטרפות ל-{preview.orgName}</CardTitle>
          <CardDescription>
            יצירת חשבון חדש עם האימייל{" "}
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
        כבר יש לך חשבון?{" "}
        <Link
          href={`/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
          className="text-primary hover:underline font-medium"
        >
          התחבר במקום
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

function ErrorCard({ title, message }: { title: string; message: string }) {
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
