"use client";

import { Suspense } from "react";
import Link from "next/link";

import {
  Aurora,
  LangToggle,
  MarketingLangProvider,
  useMarketingLang,
} from "@/components/marketing/marketing-lang";
import { LoginForm } from "./login-form";

// Glass chrome around the (unchanged) working <LoginForm>. The form's own
// fields/labels stay Hebrew — only the surrounding page copy is bilingual.
function LoginInner() {
  const { t, dir, lang } = useMarketingLang();
  return (
    <div className="mkt auth-wrap" dir={dir} lang={lang}>
      <Aurora />
      <div className="auth-topbar">
        <Link className="brand" href="/"><span className="logo-mark">א</span> AVI.APP</Link>
        <LangToggle />
      </div>
      <div className="auth-main">
        <div className="glass auth-card">
          <h1>{t("כניסה למערכת", "Log in")}</h1>
          <span className="auth-sub">{t("הזן את פרטי ההתחברות שלך", "Enter your login details")}</span>
          <div className="auth-form">
            {/* LoginForm reads useSearchParams(); Suspense lets the chrome
                render immediately and stream the form in. */}
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
          <p className="auth-alt">
            {t("עדיין לא רשום?", "No account yet?")}{" "}
            <Link href="/signup">{t("פתחו משרד חדש", "Open a new office")}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export function LoginGlass() {
  return (
    <MarketingLangProvider>
      <LoginInner />
    </MarketingLangProvider>
  );
}
