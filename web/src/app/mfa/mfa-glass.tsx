"use client";

import Link from "next/link";

import { Aurora } from "@/components/marketing/marketing-lang";
import { AuthLangToggle } from "@/components/i18n/language-switcher";
import { dirFor } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import { MfaForm } from "./mfa-form";

// Glass chrome around the MFA challenge form — same shell as login so the
// two-step sign-in feels like one flow. Chrome + form both on the central
// catalog (useT), driven by the avi-locale cookie.
export function MfaGlass({ next }: { next: string }) {
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
          <h1>{t("auth.mfa.title")}</h1>
          <span className="auth-sub">{t("auth.mfa.subtitle")}</span>
          <div className="auth-form">
            <MfaForm next={next} />
          </div>
        </div>
      </div>
    </div>
  );
}
