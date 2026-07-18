"use client";

import { Suspense } from "react";
import Link from "next/link";

import { Aurora } from "@/components/marketing/marketing-lang";
import { AuthLangToggle } from "@/components/i18n/language-switcher";
import { dirFor } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import { LoginForm } from "./login-form";

// Glass chrome around the working <LoginForm>. Both the chrome AND the form
// now run on the central catalog (useT) driven by the avi-locale cookie —
// the AuthLangToggle flips the cookie + refreshes so the whole page (and the
// app after login) switch together. dir/lang on the `.mkt` wrapper come from
// the active locale.
export function LoginGlass() {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="mkt auth-wrap" dir={dirFor(locale)} lang={locale}>
      <a className="skip" href="#main">{t("common.skipToContent")}</a>
      <Aurora />
      <div className="auth-topbar">
        <Link className="brand" href="/"><span className="logo-mark">א</span> AVI.APP</Link>
        <AuthLangToggle />
      </div>
      <main id="main" className="auth-main">
        <div className="glass auth-card">
          <h1>{t("auth.login.title")}</h1>
          <span className="auth-sub">{t("auth.login.subtitle")}</span>
          <div className="auth-form">
            {/* LoginForm reads useSearchParams(); Suspense lets the chrome
                render immediately and stream the form in. */}
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
          <p className="auth-alt">
            {t("auth.login.noAccount")}{" "}
            <Link href="/signup">{t("auth.login.openOffice")}</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
