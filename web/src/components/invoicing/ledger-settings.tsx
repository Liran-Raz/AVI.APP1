"use client";

import { useState } from "react";
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
import { BUSINESS_TYPE_LABELS } from "@/components/clients/business-types";
import { ApiError, apiClient, type LedgerDTO } from "@/lib/api-client";

// פרופיל העסק (DEV-026 R1) — the legal/tax identity printed on tax documents
// and exported in the מבנה-אחיד INI. Editable by owners only (ledgers.manage);
// everyone else gets a read-only view. Pattern mirrors settings/office-form.

type BusinessTypeValue = NonNullable<LedgerDTO["businessType"]>;

const BUSINESS_TYPE_OPTIONS = Object.entries(BUSINESS_TYPE_LABELS) as Array<
  [BusinessTypeValue, string]
>;

export function LedgerSettings({
  initial,
  canManage,
}: {
  initial: LedgerDTO;
  canManage: boolean;
}) {
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
      toast.error("שם עסק רשמי הוא שדה חובה");
      return;
    }
    if (businessId.trim() && !/^[0-9]{9}$/.test(businessId.trim())) {
      toast.error("מספר עוסק/ח.פ חייב להיות 9 ספרות בדיוק");
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
      toast.success("פרטי העסק עודכנו");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setSaving(false);
    }
  }

  const readiness = saved.issueReady ? (
    <div className="flex items-start gap-2 rounded-lg border border-status-done/30 bg-status-done/10 p-3 text-sm text-status-done">
      <BadgeCheck className="size-4 mt-0.5 shrink-0" />
      <span>פרטי העסק מלאים — ניתן להפיק מסמכים עבור בית-עסק זה.</span>
    </div>
  ) : (
    <div className="flex items-start gap-2 rounded-lg border border-status-received/30 bg-status-received/10 p-3 text-sm text-status-received">
      <AlertTriangle className="size-4 mt-0.5 shrink-0" />
      <span>
        להפקת מסמכים חובה למלא <strong>מספר עוסק/ח.פ</strong> (9 ספרות) ושם עסק
        רשמי. עד אז לא ניתן להפיק חשבוניות/קבלות.
      </span>
    </div>
  );

  if (!canManage) {
    return (
      <div className="space-y-4">
        {readiness}
        <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5">
          <ReadOnlyRow label="שם עסק רשמי" value={saved.legalName} />
          <ReadOnlyRow label="שם מסחרי" value={saved.tradeName} />
          <ReadOnlyRow label="מספר עוסק / ח.פ" value={saved.businessId} ltr />
          <ReadOnlyRow
            label="סוג עסק"
            value={saved.businessType ? BUSINESS_TYPE_LABELS[saved.businessType] : null}
          />
          <ReadOnlyRow
            label="כתובת"
            value={
              [saved.addressStreet, saved.addressCity, saved.addressZip]
                .filter(Boolean)
                .join(", ") || null
            }
          />
          <ReadOnlyRow label="טלפון" value={saved.phone} ltr />
          <ReadOnlyRow label="אימייל" value={saved.email} ltr />
          <p className="text-xs text-muted-foreground">
            רק בעלים של המשרד יכול לערוך את פרטי העסק.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {readiness}
      <form
        onSubmit={handleSubmit}
        className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="ledgerLegalName">שם עסק רשמי *</Label>
            <Input
              id="ledgerLegalName"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              maxLength={100}
              required
            />
            <p className="text-xs text-muted-foreground">
              כפי שרשום ברשויות — יודפס על המסמכים.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ledgerTradeName">שם מסחרי</Label>
            <Input
              id="ledgerTradeName"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ledgerBusinessId">מספר עוסק / ח.פ *</Label>
            <Input
              id="ledgerBusinessId"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value.replace(/\D/g, ""))}
              maxLength={9}
              dir="ltr"
              inputMode="numeric"
              placeholder="9 ספרות"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ledgerBusinessType">סוג עסק</Label>
            <Select
              value={businessType || undefined}
              onValueChange={(v) => setBusinessType(v as BusinessTypeValue)}
            >
              <SelectTrigger id="ledgerBusinessType">
                <SelectValue placeholder="בחר סוג עסק" />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPE_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              עוסק פטור מפיק מסמכים ללא מע״מ.
            </p>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ledgerStreet">רחוב ומספר</Label>
            <Input
              id="ledgerStreet"
              value={addressStreet}
              onChange={(e) => setAddressStreet(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ledgerCity">עיר</Label>
            <Input
              id="ledgerCity"
              value={addressCity}
              onChange={(e) => setAddressCity(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ledgerZip">מיקוד</Label>
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
            <Label htmlFor="ledgerPhone">טלפון</Label>
            <Input
              id="ledgerPhone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={50}
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ledgerEmail">אימייל</Label>
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
            שמירת שינויים
          </Button>
        </div>
      </form>
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
