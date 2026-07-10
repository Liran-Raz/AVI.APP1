"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
  UserSquare2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ApiError,
  apiClient,
  type ClientDTO,
  type ContactDTO,
} from "@/lib/api-client";
import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

import { ContactFormDialog } from "./contact-form-dialog";
import { formatBusinessType } from "./business-types";

type Props = {
  client: ClientDTO;
  initialContacts: ContactDTO[];
  capabilities: Capability[];
};

export function ClientDetail({ client, initialContacts, capabilities }: Props) {
  // Display-only hint: contacts.delete is Owner/Manager-only. The server
  // re-enforces this on every delete call regardless of what the UI shows.
  const canDeleteContact = hasCapability(
    capabilities,
    PERMISSIONS.CONTACTS_DELETE,
  );
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDTO[]>(initialContacts);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogTarget, setDialogTarget] = useState<ContactDTO | null>(null);

  function handleAddClick() {
    setDialogMode("create");
    setDialogTarget(null);
    setDialogOpen(true);
  }

  function handleEditClick(contact: ContactDTO) {
    setDialogMode("edit");
    setDialogTarget(contact);
    setDialogOpen(true);
  }

  async function refetch() {
    try {
      const result = await apiClient.clientContacts.list(client.id);
      setContacts(result.items);
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  function handleSaved() {
    void refetch();
  }

  async function handleDelete(contact: ContactDTO) {
    if (!window.confirm(`למחוק את "${contact.name}"?`)) return;
    try {
      await apiClient.clientContacts.delete(client.id, contact.id);
      toast.success("איש קשר נמחק");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/clients")}
        >
          <ArrowRight className="size-4" />
          חזרה ללקוחות
        </Button>
      </div>

      {/* Client header */}
      <div className="border border-border rounded-lg glass-card shadow-card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
              {client.name.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                {client.name}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {formatBusinessType(client.businessType)}
                {client.taxId && (
                  <>
                    {" · "}
                    <span dir="ltr">{client.taxId}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {client.isActive ? (
              <Badge variant="secondary">פעיל</Badge>
            ) : (
              <Badge variant="outline">בארכיון</Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">אימייל</p>
            <p className="text-sm" dir="ltr">{client.email ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">טלפון</p>
            <p className="text-sm" dir="ltr">{client.phone ?? "—"}</p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-xs text-muted-foreground">כתובת</p>
            <p className="text-sm">{client.address ?? "—"}</p>
          </div>
          {client.notes && (
            <div className="space-y-1 sm:col-span-2">
              <p className="text-xs text-muted-foreground">הערות</p>
              <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Contacts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">אנשי קשר</h2>
          <Button onClick={handleAddClick} size="sm">
            <Plus className="size-4" />
            איש קשר
          </Button>
        </div>

        {contacts.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg glass-card shadow-card p-10 text-center">
            <div className="size-10 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
              <UserSquare2 className="size-5" />
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              עוד אין אנשי קשר. הוסף את הראשון.
            </p>
            <Button onClick={handleAddClick} size="sm">
              <Plus className="size-4" />
              הוסף איש קשר
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {contacts.map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                canDelete={canDeleteContact}
                onEdit={() => handleEditClick(c)}
                onDelete={() => handleDelete(c)}
              />
            ))}
          </div>
        )}
      </div>

      <ContactFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        clientId={client.id}
        initial={dialogTarget}
        onSaved={() => handleSaved()}
      />
    </div>
  );
}

function ContactCard({
  contact,
  canDelete,
  onEdit,
  onDelete,
}: {
  contact: ContactDTO;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group rounded-lg border glass-card shadow-card p-4 space-y-2",
        contact.isPrimary ? "border-primary/40" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{contact.name}</h3>
          {contact.isPrimary && (
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/20"
            >
              <Star className="size-3" />
              ראשי
            </Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-60 group-hover:opacity-100"
              aria-label={`פעולות עבור ${contact.name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              ערוך
            </DropdownMenuItem>
            {canDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                מחק
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {contact.role && (
        <p className="text-sm text-muted-foreground">{contact.role}</p>
      )}

      <div className="space-y-1 text-sm">
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="inline-flex items-center gap-2 text-foreground hover:text-primary"
            dir="ltr"
          >
            <Phone className="size-3" />
            {contact.phone}
          </a>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex items-center gap-2 text-foreground hover:text-primary break-all"
            dir="ltr"
          >
            <Mail className="size-3" />
            {contact.email}
          </a>
        )}
      </div>
    </div>
  );
}
