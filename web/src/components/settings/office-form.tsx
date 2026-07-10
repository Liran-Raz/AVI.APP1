"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiClient } from "@/lib/api-client";
import type { SettingsOrganization } from "./settings-page";

// The office code is the invite/join identifier — always shown, always
// read-only, with a copy button (used when inviting teammates).
function OrgCodeRow({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("קוד המשרד הועתק");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("לא ניתן להעתיק");
    }
  }

  return (
    <div className="space-y-2">
      <Label>קוד משרד</Label>
      <div className="flex items-center gap-2">
        <Input value={code} readOnly disabled dir="ltr" className="font-mono" />
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="העתקת קוד משרד">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        הקוד משמש להזמנת חברי צוות והצטרפות למשרד. אינו ניתן לשינוי.
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
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    name.trim() !== saved.name.trim() ||
    email.trim() !== (saved.email ?? "").trim() ||
    phone.trim() !== (saved.phone ?? "").trim() ||
    address.trim() !== (saved.address ?? "").trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("שם המשרד הוא שדה חובה");
      return;
    }
    if (!dirty) return;
    setSaving(true);
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
      };
      setSaved(next);
      setName(next.name);
      setEmail(next.email ?? "");
      setPhone(next.phone ?? "");
      setAddress(next.address ?? "");
      toast.success("פרטי המשרד עודכנו");
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

  // Non-owners: read-only view of the office details.
  if (!canEdit) {
    return (
      <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5">
        <ReadOnlyRow label="שם המשרד" value={initial.name} />
        <OrgCodeRow code={initial.orgCode} />
        <ReadOnlyRow label="אימייל" value={initial.email} ltr />
        <ReadOnlyRow label="טלפון" value={initial.phone} ltr />
        <ReadOnlyRow label="כתובת" value={initial.address} />
        <p className="text-xs text-muted-foreground">
          רק בעלים של המשרד יכול לערוך את הפרטים האלה.
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
        <Label htmlFor="officeName">שם המשרד</Label>
        <Input
          id="officeName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
      </div>

      <OrgCodeRow code={initial.orgCode} />

      <div className="space-y-2">
        <Label htmlFor="officeEmail">אימייל</Label>
        <Input
          id="officeEmail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          dir="ltr"
          placeholder="office@example.com"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="officePhone">טלפון</Label>
        <Input
          id="officePhone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={50}
          dir="ltr"
          placeholder="03-0000000"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="officeAddress">כתובת</Label>
        <Textarea
          id="officeAddress"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={500}
          rows={2}
        />
      </div>

      <div className="flex justify-start pt-1">
        <Button type="submit" disabled={saving || !dirty}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          שמירת שינויים
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
