"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  apiClient,
  BUSINESS_TYPES,
  type ClientDTO,
  type CreateClientPayload,
  type MemberDTO,
  type UpdateClientPayload,
} from "@/lib/api-client";
import { BUSINESS_TYPE_LABELS } from "./business-types";

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  initial: ClientDTO | null;
  members: MemberDTO[]; // for the "handling staff member" picker
  onSaved: (saved: ClientDTO) => void;
};

// Radix Select.Item cannot have an empty string value. Use a sentinel
// that we translate to null when submitting.
const NONE = "__none__";

type FormState = {
  name: string;
  businessType: string;
  taxId: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  handlingUserId: string; // NONE or a member UUID
};

function emptyState(): FormState {
  return {
    name: "",
    businessType: NONE,
    taxId: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    handlingUserId: NONE,
  };
}

function stateFromDTO(dto: ClientDTO): FormState {
  return {
    name: dto.name,
    businessType: dto.businessType ?? NONE,
    taxId: dto.taxId ?? "",
    email: dto.email ?? "",
    phone: dto.phone ?? "",
    address: dto.address ?? "",
    notes: dto.notes ?? "",
    handlingUserId: dto.handlingUserId ?? NONE,
  };
}

export function ClientFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  members,
  onSaved,
}: Props) {
  // Keying the inner form by mode + id ensures fresh state every time the
  // dialog opens for a different target — no useEffect-driven resets.
  const formKey = mode === "edit" ? (initial?.id ?? "edit") : "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "לקוח חדש" : "עריכת לקוח"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "הוספת לקוח חדש למשרד שלך."
              : "עדכון פרטי הלקוח."}
          </DialogDescription>
        </DialogHeader>

        <ClientFormBody
          key={formKey}
          mode={mode}
          initial={initial}
          members={members}
          onCancel={() => onOpenChange(false)}
          onSaved={(saved) => {
            onSaved(saved);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ClientFormBody({
  mode,
  initial,
  members,
  onCancel,
  onSaved,
}: {
  mode: Mode;
  initial: ClientDTO | null;
  members: MemberDTO[];
  onCancel: () => void;
  onSaved: (saved: ClientDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && initial ? stateFromDTO(initial) : emptyState(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Active members, plus the currently-selected one even if it went inactive
  // (so editing a client whose handler was deactivated still shows a name).
  const handlerOptions = members.filter(
    (m) => m.isActive || m.id === form.handlingUserId,
  );

  function buildCreatePayload(): CreateClientPayload {
    return {
      name: form.name.trim(),
      businessType:
        form.businessType === NONE
          ? null
          : (form.businessType as CreateClientPayload["businessType"]),
      taxId: form.taxId.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      handlingUserId: form.handlingUserId === NONE ? null : form.handlingUserId,
    };
  }

  // For update we send the full set of editable fields. Since the form was
  // pre-filled from the row, untouched values are sent back unchanged —
  // the server treats this as a no-op assignment.
  function buildUpdatePayload(): UpdateClientPayload {
    return {
      name: form.name.trim(),
      businessType:
        form.businessType === NONE
          ? null
          : (form.businessType as UpdateClientPayload["businessType"]),
      taxId: form.taxId.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      handlingUserId: form.handlingUserId === NONE ? null : form.handlingUserId,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("שם הלקוח הוא שדה חובה");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved =
        mode === "create"
          ? await apiClient.clients.create(buildCreatePayload())
          : await apiClient.clients.update(initial!.id, buildUpdatePayload());
      toast.success(mode === "create" ? "לקוח נוצר" : "לקוח עודכן");
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error(`שגיאה: ${err.message}`);
      } else {
        setError("שגיאה לא צפויה");
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
    >
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="client-name">
          שם <span className="text-destructive">*</span>
        </Label>
        <Input
          id="client-name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="client-business-type">סוג עסק</Label>
        <Select
          value={form.businessType}
          onValueChange={(v) => set("businessType", v)}
        >
          <SelectTrigger id="client-business-type" className="w-full">
            <SelectValue placeholder="בחר סוג עסק" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>ללא</SelectItem>
            {BUSINESS_TYPES.map((bt) => (
              <SelectItem key={bt} value={bt}>
                {BUSINESS_TYPE_LABELS[bt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="client-tax-id">מספר עוסק / ח״פ</Label>
        <Input
          id="client-tax-id"
          value={form.taxId}
          onChange={(e) => set("taxId", e.target.value)}
          maxLength={50}
          dir="ltr"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="client-email">אימייל</Label>
        <Input
          id="client-email"
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          maxLength={254}
          dir="ltr"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="client-phone">טלפון</Label>
        <Input
          id="client-phone"
          type="tel"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          maxLength={50}
          dir="ltr"
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="client-address">כתובת</Label>
        <Input
          id="client-address"
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          maxLength={500}
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="client-handler">גורם מטפל</Label>
        <Select
          value={form.handlingUserId}
          onValueChange={(v) => set("handlingUserId", v)}
        >
          <SelectTrigger id="client-handler" className="w-full">
            <SelectValue placeholder="בחר גורם מטפל" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>ללא גורם מטפל</SelectItem>
            {handlerOptions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.fullName}
                {!m.isActive ? " (לא פעיל)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="client-notes">הערות</Label>
        <Textarea
          id="client-notes"
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          maxLength={5000}
          rows={3}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive sm:col-span-2">{error}</p>
      )}

      <DialogFooter className="sm:col-span-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          ביטול
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {mode === "create" ? "צור לקוח" : "שמור שינויים"}
        </Button>
      </DialogFooter>
    </form>
  );
}
