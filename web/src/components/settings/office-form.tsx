"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiClient } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";
import type { SettingsOrganization } from "./settings-page";

// The office code is the invite/join identifier — always shown, always
// read-only, with a copy button (used when inviting teammates).
function OrgCodeRow({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("settings.office.codeCopied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("settings.office.copyFailed"));
    }
  }

  return (
    <div className="space-y-2">
      <Label>{t("settings.office.code")}</Label>
      <div className="flex items-center gap-2">
        <Input value={code} readOnly disabled dir="ltr" className="font-mono" />
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={t("settings.office.copyAria")}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.office.codeHint")}
      </p>
    </div>
  );
}

export function OfficeForm({
  initial,
  canEdit,
}: {
  initial: SettingsOrganization;
  canEdit: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== saved.name.trim() ||
    email.trim() !== (saved.email ?? "").trim() ||
    phone.trim() !== (saved.phone ?? "").trim() ||
    address.trim() !== (saved.address ?? "").trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("settings.office.nameRequired"));
      return;
    }
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient.organization.update({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
      });
      const next: SettingsOrganization = {
        name: updated.name,
        orgCode: updated.orgCode,
        email: updated.email,
        phone: updated.phone,
        address: updated.address,
        requireMfa: updated.requireMfa,
      };
      setSaved(next);
      setName(next.name);
      setEmail(next.email ?? "");
      setPhone(next.phone ?? "");
      setAddress(next.address ?? "");
      toast.success(t("settings.office.updated"));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error(err.message);
      } else {
        setError(t("common.unexpectedError"));
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setSaving(false);
    }
  }

  // Non-owners: read-only view of the office details.
  if (!canEdit) {
    return (
      <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5">
        <ReadOnlyRow label={t("settings.office.name")} value={initial.name} />
        <OrgCodeRow code={initial.orgCode} />
        <ReadOnlyRow label={t("common.email")} value={initial.email} ltr />
        <ReadOnlyRow label={t("common.phone")} value={initial.phone} ltr />
        <ReadOnlyRow label={t("settings.office.address")} value={initial.address} />
        <p className="text-xs text-muted-foreground">
          {t("settings.office.readonlyHint")}
        </p>
      </div>
    );
  }

  // Owner: editable form.
  return (
    <form
      onSubmit={handleSubmit}
      className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5"
    >
      <div className="space-y-2">
        <Label htmlFor="officeName">{t("settings.office.name")}</Label>
        <Input
          id="officeName"
          value={name}
          onChange={(e) => {
            if (error) setError(null);
            setName(e.target.value);
          }}
          maxLength={120}
          required
          autoComplete="organization"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "office-error" : undefined}
        />
      </div>

      <OrgCodeRow code={initial.orgCode} />

      <div className="space-y-2">
        <Label htmlFor="officeEmail">{t("common.email")}</Label>
        <Input
          id="officeEmail"
          type="email"
          value={email}
          onChange={(e) => {
            if (error) setError(null);
            setEmail(e.target.value);
          }}
          maxLength={254}
          dir="ltr"
          placeholder="office@example.com"
          autoComplete="email"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "office-error" : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="officePhone">{t("common.phone")}</Label>
        <Input
          id="officePhone"
          value={phone}
          onChange={(e) => {
            if (error) setError(null);
            setPhone(e.target.value);
          }}
          maxLength={50}
          dir="ltr"
          placeholder="03-0000000"
          autoComplete="tel"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="officeAddress">{t("settings.office.address")}</Label>
        <Textarea
          id="officeAddress"
          value={address}
          onChange={(e) => {
            if (error) setError(null);
            setAddress(e.target.value);
          }}
          maxLength={500}
          rows={2}
          autoComplete="street-address"
        />
      </div>

      <FormError id="office-error" message={error} />

      <div className="flex justify-start pt-1">
        <Button type="submit" disabled={saving || !dirty}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t("common.saveChanges")}
        </Button>
      </div>
    </form>
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
