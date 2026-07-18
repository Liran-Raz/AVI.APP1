"use client";

import Link from "next/link";

import { Aurora } from "@/components/marketing/marketing-lang";
import { AuthLangToggle } from "@/components/i18n/language-switcher";
import { dirFor } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import { SignupForm } from "./signup-form";

// Glass chrome around the working <SignupForm>. Chrome + form both run on the
// central catalog (useT) driven by the avi-locale cookie; the AuthLangToggle
// flips it + refreshes so the whole page switches together.
export function SignupGlass() {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="mkt auth-wrap" dir={dirFor(locale)} lang={locale}>
      <Aurora />
      <div className="auth-topbar">
        <Link className="brand" href="/"><span className="logo-mark">א</span> AVI.APP</Link>
        <AuthLangToggle />
      </div>
      <div className="auth-main">
        <div className="glass auth-card">
          <h1>{t("auth.signup.title")}</h1>
          <span className="auth-sub">{t("auth.signup.subtitle")}</span>
          <div className="auth-form">
            <SignupForm />
          </div>
          <p className="auth-alt">
            {t("auth.signup.haveAccount")}{" "}
            <Link href="/login">{t("auth.login.title")}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
