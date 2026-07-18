"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  apiClient,
  BUSINESS_TYPES,
  type LedgerDTO,
} from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

// פרופיל העסק (DEV-026 R1) — the legal/tax identity printed on tax documents
// and exported in the מבנה-אחיד INI. Editable by owners only (ledgers.manage);
// everyone else gets a read-only view. Pattern mirrors settings/office-form.

type BusinessTypeValue = NonNullable<LedgerDTO["businessType"]>;

export function LedgerSettings({
  initial,
  canManage,
}: {
  initial: LedgerDTO;
  canManage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [legalName, setLegalName] = useState(initial.legalName);
  const [tradeName, setTradeName] = useState(initial.tradeName ?? "");
  const [businessId, setBusinessId] = useState(initial.businessId ?? "");
  const [businessType, setBusinessType] = useState<BusinessTypeValue | "">(
    initial.businessType ?? "",
  );
  const [addressStreet, setAddressStreet] = useState(initial.addressStreet ?? "");
  const [addressCity, setAddressCity] = useState(initial.addressCity ?? "");
  const [addressZip, setAddressZip] = useState(initial.addressZip ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    legalName.trim() !== saved.legalName.trim() ||
    tradeName.trim() !== (saved.tradeName ?? "").trim() ||
    businessId.trim() !== (saved.businessId ?? "").trim() ||
    (businessType || "") !== (saved.businessType ?? "") ||
    addressStreet.trim() !== (saved.addressStreet ?? "").trim() ||
    addressCity.trim() !== (saved.addressCity ?? "").trim() ||
    addressZip.trim() !== (saved.addressZip ?? "").trim() ||
    phone.trim() !== (saved.phone ?? "").trim() ||
    email.trim() !== (saved.email ?? "").trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!legalName.trim()) {
      toast.error(t("invoicing.settings.legalNameRequired"));
      return;
    }
    if (businessId.trim() && !/^[0-9]{9}$/.test(businessId.trim())) {
      toast.error(t("invoicing.settings.businessIdInvalid"));
      return;
    }
    if (!dirty) return;
    setSaving(true);
    try {
      const updated = await apiClient.ledgers.update(saved.id, {
        legalName: legalName.trim(),
        tradeName: tradeName.trim(),
        businessId: businessId.trim(),
        businessType: businessType === "" ? null : businessType,
        addressStreet: addressStreet.trim(),
        addressCity: addressCity.trim(),
        addressZip: addressZip.trim(),
        phone: phone.trim(),
        email: email.trim(),
      });
      setSaved(updated);
      setLegalName(updated.legalName);
      setTradeName(updated.tradeName ?? "");
      setBusinessId(updated.businessId ?? "");
      setBusinessType(updated.businessType ?? "");
      setAddressStreet(updated.addressStreet ?? "");
      setAddressCity(updated.addressCity ?? "");
      setAddressZip(updated.addressZip ?? "");
      setPhone(updated.phone ?? "");
      setEmail(updated.email ?? "");
      toast.success(t("invoicing.settings.updatedToast"));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setSaving(false);
    }
  }

  // The page header (back-link + title + description) lives here rather than
  // in the server page so its strings render through the client i18n catalog.
  const header = (
    <div>
      <Link href="/invoicing" className="text-sm text-primary hover:underline">
        {t("invoicing.backToDocuments")}
      </Link>
      <h1 className="text-xl font-bold mt-2">{t("invoicing.settings.title")}</h1>
      <p className="text-sm text-muted-foreground mt-1">
        {t("invoicing.settings.subtitle")}
      </p>
    </div>
  );

  const readiness = saved.issueReady ? (
    <div className="flex items-start gap-2 rounded-lg border border-status-done/30 bg-status-done/10 p-3 text-sm text-status-done">
      <BadgeCheck className="size-4 mt-0.5 shrink-0" />
      <span>{t("invoicing.settings.readyBanner")}</span>
    </div>
  ) : (
    <div className="flex items-start gap-2 rounded-lg border border-status-received/30 bg-status-received/10 p-3 text-sm text-status-received">
      <AlertTriangle className="size-4 mt-0.5 shrink-0" />
      <span>
        {t("invoicing.settings.notReadyBeforeStrong")}
        <strong>{t("invoicing.settings.notReadyStrong")}</strong>
        {t("invoicing.settings.notReadyAfterStrong")}
      </span>
    </div>
  );

  if (!canManage) {
    return (
      <div className="space-y-6">
        {header}
        <div className="space-y-4">
          {readiness}
          <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5">
            <ReadOnlyRow
              label={t("invoicing.settings.legalName")}
              value={saved.legalName}
            />
            <ReadOnlyRow
              label={t("invoicing.settings.tradeName")}
              value={saved.tradeName}
            />
            <ReadOnlyRow
              label={t("invoicing.settings.businessId")}
              value={saved.businessId}
              ltr
            />
            <ReadOnlyRow
              label={t("invoicing.settings.businessType")}
              value={
                saved.businessType
                  ? t(`businessType.${saved.businessType}` as MessageKey)
                  : null
              }
            />
            <ReadOnlyRow
              label={t("invoicing.settings.address")}
              value={
                [saved.addressStreet, saved.addressCity, saved.addressZip]
                  .filter(Boolean)
                  .join(", ") || null
              }
            />
            <ReadOnlyRow label={t("common.phone")} value={saved.phone} ltr />
            <ReadOnlyRow label={t("common.email")} value={saved.email} ltr />
            <p className="text-xs text-muted-foreground">
              {t("invoicing.settings.readonlyHint")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <div className="space-y-4">
        {readiness}
        <form
          onSubmit={handleSubmit}
          className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="ledgerLegalName">
                {t("invoicing.settings.legalName")} *
              </Label>
              <Input
                id="ledgerLegalName"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                maxLength={100}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("invoicing.settings.legalNameHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledgerTradeName">
                {t("invoicing.settings.tradeName")}
              </Label>
              <Input
                id="ledgerTradeName"
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledgerBusinessId">
                {t("invoicing.settings.businessId")} *
              </Label>
              <Input
                id="ledgerBusinessId"
                value={businessId}
                onChange={(e) => setBusinessId(e.target.value.replace(/\D/g, ""))}
                maxLength={9}
                dir="ltr"
                inputMode="numeric"
                placeholder={t("invoicing.settings.nineDigitsPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledgerBusinessType">
                {t("invoicing.settings.businessType")}
              </Label>
              <Select
                value={businessType || undefined}
                onValueChange={(v) => setBusinessType(v as BusinessTypeValue)}
              >
                <SelectTrigger id="ledgerBusinessType">
                  <SelectValue
                    placeholder={t("invoicing.settings.businessTypePlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`businessType.${value}` as MessageKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("invoicing.settings.paturHint")}
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ledgerStreet">
                {t("invoicing.settings.street")}
              </Label>
              <Input
                id="ledgerStreet"
                value={addressStreet}
                onChange={(e) => setAddressStreet(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledgerCity">{t("invoicing.settings.city")}</Label>
              <Input
                id="ledgerCity"
                value={addressCity}
                onChange={(e) => setAddressCity(e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledgerZip">{t("invoicing.settings.zip")}</Label>
              <Input
                id="ledgerZip"
                value={addressZip}
                onChange={(e) => setAddressZip(e.target.value.replace(/\D/g, ""))}
                maxLength={7}
                dir="ltr"
                inputMode="numeric"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledgerPhone">{t("common.phone")}</Label>
              <Input
                id="ledgerPhone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={50}
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledgerEmail">{t("common.email")}</Label>
              <Input
                id="ledgerEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex justify-start pt-1">
            <Button type="submit" disabled={saving || !dirty}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t("common.saveChanges")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string | null;
  ltr?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm" dir={ltr ? "ltr" : undefined}>
        {value && value.length > 0 ? value : "—"}
      </p>
    </div>
  );
}
