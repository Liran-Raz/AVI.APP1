"use client";

import Link from "next/link";

import {
  Aurora,
  LangToggle,
  MarketingLangProvider,
  useMarketingLang,
} from "@/components/marketing/marketing-lang";
import { MfaForm } from "./mfa-form";

// Glass chrome around the MFA challenge form — same shell as the login
// page so the two-step sign-in feels like one continuous flow. The form's
// own labels stay Hebrew; only the page chrome is bilingual.
function MfaInner({ next }: { next: string }) {
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
          <h1>{t("אימות דו-שלבי", "Two-factor authentication")}</h1>
          <span className="auth-sub">
            {t(
              "הזן את הקוד בן 6 הספרות מאפליקציית האימות שלך",
              "Enter the 6-digit code from your authenticator app",
            )}
          </span>
          <div className="auth-form">
            <MfaForm next={next} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MfaGlass({ next }: { next: string }) {
  return (
    <MarketingLangProvider>
      <MfaInner next={next} />
    </MarketingLangProvider>
  );
}
