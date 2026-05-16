import { Suspense } from "react";
import Link from "next/link";

import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
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
            <CardTitle className="text-2xl">כניסה למערכת</CardTitle>
            <CardDescription>הזן את פרטי ההתחברות שלך</CardDescription>
          </CardHeader>
          <CardContent>
            {/* LoginForm uses useSearchParams() — Suspense lets Next.js
                statically render the surrounding chrome and stream the
                form once search params are available. */}
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          עדיין לא רשום?{" "}
          <Link href="/signup" className="text-primary hover:underline font-medium">
            פתחו משרד חדש
          </Link>
        </p>
      </div>
    </div>
  );
}
