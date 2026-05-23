import Link from "next/link";

import { ForgotPasswordForm } from "./forgot-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Public page — middleware does NOT include /forgot-password in
// PROTECTED_PREFIXES, so it is reachable without a session.
export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 bg-muted/30">
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
            <CardTitle className="text-2xl">שחזור סיסמה</CardTitle>
            <CardDescription>
              הזן את האימייל שלך ונשלח לך קישור לאיפוס.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm />
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="text-primary hover:underline font-medium"
          >
            חזרה להתחברות
          </Link>
        </p>
      </div>
    </div>
  );
}
