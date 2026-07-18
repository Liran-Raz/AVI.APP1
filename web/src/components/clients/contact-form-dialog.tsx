"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  apiClient,
  type ContactDTO,
  type CreateContactPayload,
  type UpdateContactPayload,
} from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  clientId: string;
  initial: ContactDTO | null;
  onSaved: (saved: ContactDTO) => void;
};

type FormState = {
  name: string;
  role: string;
  phone: string;
  email: string;
  isPrimary: boolean;
};

function emptyState(): FormState {
  return { name: "", role: "", phone: "", email: "", isPrimary: false };
}

function stateFromContact(c: ContactDTO): FormState {
  return {
    name: c.name,
    role: c.role ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    isPrimary: c.isPrimary,
  };
}

export function ContactFormDialog({
  open,
  onOpenChange,
  mode,
  clientId,
  initial,
  onSaved,
}: Props) {
  const t = useT();
  const formKey = mode === "edit" ? (initial?.id ?? "edit") : "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? t("clients.contact.createTitle")
              : t("clients.contact.editTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? t("clients.contact.createDesc")
              : t("clients.contact.editDesc")}
          </DialogDescription>
        </DialogHeader>

        <ContactFormBody
          key={formKey}
          mode={mode}
          clientId={clientId}
          initial={initial}
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

function ContactFormBody({
  mode,
  clientId,
  initial,
  onCancel,
  onSaved,
}: {
  mode: Mode;
  clientId: string;
  initial: ContactDTO | null;
  onCancel: () => void;
  onSaved: (saved: ContactDTO) => void;
}) {
  const t = useT();
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && initial ? stateFromContact(initial) : emptyState(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (error) setError(null);
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t("clients.contact.nameRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const createPayload: CreateContactPayload = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        isPrimary: form.isPrimary,
      };
      const updatePayload: UpdateContactPayload = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        isPrimary: form.isPrimary,
      };
      const saved =
        mode === "create"
          ? await apiClient.clientContacts.create(clientId, createPayload)
          : await apiClient.clientContacts.update(
              clientId,
              initial!.id,
              updatePayload,
            );
      toast.success(
        mode === "create"
          ? t("clients.contact.createdToast")
          : t("clients.contact.updatedToast"),
      );
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error(t("clients.errorWithMessage", { message: err.message }));
      } else {
        setError(t("common.unexpectedError"));
        toast.error(t("common.unexpectedError"));
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
        <Label htmlFor="contact-name">
          {t("clients.contact.name")} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="contact-name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={200}
          required
          autoFocus
          autoComplete="name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "contact-error" : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-role">{t("clients.contact.role")}</Label>
        <Input
          id="contact-role"
          value={form.role}
          onChange={(e) => set("role", e.target.value)}
          maxLength={100}
          placeholder={t("clients.contact.rolePlaceholder")}
          autoComplete="off"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-phone">{t("common.phone")}</Label>
        <Input
          id="contact-phone"
          type="tel"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          maxLength={50}
          dir="ltr"
          autoComplete="tel"
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="contact-email">{t("common.email")}</Label>
        <Input
          id="contact-email"
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          maxLength={254}
          dir="ltr"
          autoComplete="email"
        />
      </div>

      <div className="flex items-center gap-2 sm:col-span-2">
        <Checkbox
          id="contact-primary"
          checked={form.isPrimary}
          onCheckedChange={(v) => set("isPrimary", v === true)}
        />
        <Label
          htmlFor="contact-primary"
          className="text-sm font-normal cursor-pointer"
        >
          {t("clients.contact.isPrimaryLabel")}
        </Label>
      </div>

      <FormError id="contact-error" message={error} className="sm:col-span-2" />

      <DialogFooter className="sm:col-span-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {mode === "create"
            ? t("clients.contact.submitCreate")
            : t("clients.contact.submitSave")}
        </Button>
      </DialogFooter>
    </form>
  );
}
