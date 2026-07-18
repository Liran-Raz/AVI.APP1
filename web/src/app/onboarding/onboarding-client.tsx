"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { ApiError, apiClient } from "@/lib/api-client";
import { ORG_CODE_RE } from "@/server/validators/onboarding.schema";
import { useT } from "@/i18n/locale-provider";

// Must match the constant in signup-form.tsx — kept inline (not exported)
// because this is the only producer/consumer pair and the key is private.
const PENDING_ONBOARDING_KEY = "avi.pendingOnboarding";

type BootstrapError = { code?: string; message: string };

export function OnboardingClient({
  email,
  initialOrgName,
  initialOrgCode,
  initialFullName,
}: {
  email: string;
  initialOrgName: string;
  initialOrgCode: string;
  initialFullName: string;
}) {
  const t = useT();
  const router = useRouter();
  const [orgName, setOrgName] = useState(initialOrgName);
  const [orgCode, setOrgCode] = useState(initialOrgCode);
  const [fullName, setFullName] = useState(initialFullName);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<BootstrapError | null>(null);

  // On first mount, recover any org details signup-form stashed for us.
  // We only fill empty fields — props from the server take precedence.
  // sessionStorage is a browser API not available during SSR, so this MUST
  // run in an effect; the eslint rule against setState-in-effect doesn't
  // apply when syncing with non-React external state.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_ONBOARDING_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { orgName?: string; orgCode?: string };
      if (parsed.orgName && !initialOrgName) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrgName(parsed.orgName);
      }
      if (parsed.orgCode && !initialOrgCode) setOrgCode(parsed.orgCode);
    } catch {
      // ignore — user will retype
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoRanRef = useRef(false);
  const canAutoBootstrap =
    initialOrgName && ORG_CODE_RE.test(initialOrgCode) && initialFullName;

  useEffect(() => {
    if (!canAutoBootstrap || autoRanRef.current) return;
    autoRanRef.current = true;
    void bootstrap(initialOrgName, initialOrgCode, initialFullName, /*silent*/ true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap(
    name: string,
    code: string,
    fname: string,
    silent = false,
  ) {
    setSubmitting(true);
    setLastError(null);
    try {
      await apiClient.onboarding.bootstrap({
        orgName: name,
        orgCode: code,
        fullName: fname,
      });
      // Success — drop any stashed signup hint and head to /tasks.
      try {
        sessionStorage.removeItem(PENDING_ONBOARDING_KEY);
      } catch {
        /* noop */
      }
      toast.success(t("onboarding.createdToast"));
      router.push("/tasks");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setLastError({ code: err.code, message: err.message });
        if (!silent) toast.error(t("onboarding.errorWithMessage", { message: err.message }));
      } else {
        setLastError({ message: t("common.unexpectedError") });
        if (!silent) toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await bootstrap(orgName, orgCode, fullName);
  }

  async function handleLogout() {
    try {
      await apiClient.auth.signOut();
    } catch {
      /* best-effort — still navigate away */
    }
    router.push("/login");
    router.refresh();
  }

  if (canAutoBootstrap && submitting && !lastError) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12 bg-muted/30">
        <div className="text-center space-y-3">
          <Loader2 className="size-8 mx-auto animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("onboarding.bootstrapping")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 bg-muted/30">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2">
            <div className="size-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
              א
            </div>
            <span className="font-bold text-xl">AVI.APP</span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{t("onboarding.title")}</CardTitle>
            <CardDescription>{t("onboarding.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                <span className="text-muted-foreground" dir="ltr">
                  {email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <LogOut className="size-3" />
                  {t("onboarding.loginAsOther")}
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fullName">{t("common.fullName")}</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => {
                    if (lastError) setLastError(null);
                    setFullName(e.target.value);
                  }}
                  autoComplete="name"
                  aria-invalid={lastError ? true : undefined}
                  aria-describedby={lastError ? "onboarding-error" : undefined}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgName">{t("onboarding.orgNameLabel")}</Label>
                <Input
                  id="orgName"
                  value={orgName}
                  onChange={(e) => {
                    if (lastError) setLastError(null);
                    setOrgName(e.target.value);
                  }}
                  placeholder={t("onboarding.orgNamePlaceholder")}
                  autoComplete="organization"
                  aria-invalid={lastError ? true : undefined}
                  aria-describedby={lastError ? "onboarding-error" : undefined}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgCode">{t("onboarding.orgCodeLabel")}</Label>
                <Input
                  id="orgCode"
                  value={orgCode}
                  onChange={(e) => {
                    if (lastError) setLastError(null);
                    setOrgCode(e.target.value.toUpperCase());
                  }}
                  pattern="[A-Z0-9-]{3,20}"
                  autoComplete="off"
                  aria-invalid={lastError ? true : undefined}
                  aria-describedby={lastError ? "onboarding-error" : undefined}
                  dir="ltr"
                  className="text-start uppercase font-mono"
                  required
                />
              </div>
              <FormError id="onboarding-error" message={lastError?.message} />

              <Button type="submit" className="w-full h-11" disabled={submitting}>
                {submitting ? t("onboarding.submitting") : t("onboarding.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
