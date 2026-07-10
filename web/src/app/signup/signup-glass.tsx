"use client";

import Link from "next/link";

import {
  Aurora,
  LangToggle,
  MarketingLangProvider,
  useMarketingLang,
} from "@/components/marketing/marketing-lang";
import { SignupForm } from "./signup-form";

// Glass chrome around the (unchanged) working <SignupForm>. The form's own
// fields/labels stay Hebrew — only the surrounding page copy is bilingual.
function SignupInner() {
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
          <h1>{t("פתיחת משרד חדש", "Open a new office")}</h1>
          <span className="auth-sub">{t("30 שניות והכל מוכן. ללא כרטיס אשראי.", "30 seconds and you're set. No credit card.")}</span>
          <div className="auth-form">
            <SignupForm />
          </div>
          <p className="auth-alt">
            {t("יש לך כבר חשבון?", "Already have an account?")}{" "}
            <Link href="/login">{t("כניסה למערכת", "Log in")}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export function SignupGlass() {
  return (
    <MarketingLangProvider>
      <SignupInner />
    </MarketingLangProvider>
  );
}
