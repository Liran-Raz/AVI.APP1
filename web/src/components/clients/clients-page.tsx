"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Eye,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  apiClient,
  BUSINESS_TYPES,
  type ClientDTO,
  type ListClientsQuery,
} from "@/lib/api-client";
import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import { ClientFormDialog } from "./client-form-dialog";
import { BUSINESS_TYPE_LABELS, formatBusinessType } from "./business-types";

type StatusFilter = "active" | "archived" | "all";
type BusinessTypeFilter = "all" | (typeof BUSINESS_TYPES)[number];

const SEARCH_DEBOUNCE_MS = 300;

export function ClientsPage({
  initialItems,
  capabilities,
}: {
  initialItems: ClientDTO[];
  capabilities: Capability[];
}) {
  const [items, setItems] = useState<ClientDTO[]>(initialItems);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [businessType, setBusinessType] = useState<BusinessTypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [loading, setLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogTarget, setDialogTarget] = useState<ClientDTO | null>(null);

  // Display-only hint; the server re-checks clients.archive on every call.
  const canArchive = hasCapability(capabilities, PERMISSIONS.CLIENTS_ARCHIVE);

  // Debounce the search input → debouncedSearch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Skip the first refetch — the server already gave us the initial list
  // matching the default query (status=active). Refetch only when filters
  // actually move off the initial state, or after mutations.
  const isFirstRun = useRef(true);
  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const query: Partial<ListClientsQuery> = {
        status,
        businessType: businessType === "all" ? undefined : businessType,
        search: debouncedSearch || undefined,
      };
      const result = await apiClient.clients.list(query);
      setItems(result.items);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(`שגיאה בטעינת לקוחות: ${err.message}`);
      } else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }, [status, businessType, debouncedSearch]);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    void refetch();
  }, [refetch]);

  function handleCreateClick() {
    setDialogMode("create");
    setDialogTarget(null);
    setDialogOpen(true);
  }

  function handleEditClick(client: ClientDTO) {
    setDialogMode("edit");
    setDialogTarget(client);
    setDialogOpen(true);
  }

  async function handleArchive(client: ClientDTO) {
    if (!canArchive) return;
    if (!window.confirm(`להעביר את "${client.name}" לארכיון?`)) return;
    try {
      await apiClient.clients.archive(client.id);
      toast.success("לקוח הועבר לארכיון");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  async function handleRestore(client: ClientDTO) {
    if (!canArchive) return;
    try {
      await apiClient.clients.restore(client.id);
      toast.success("לקוח שוחזר");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  function handleSaved(saved: ClientDTO) {
    // Merge or insert the saved client into the local list. If the saved
    // row doesn't match current filters, refetch will reconcile.
    setItems((prev) => {
      const idx = prev.findIndex((c) => c.id === saved.id);
      if (idx === -1) return [saved, ...prev];
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
    // Refetch in the background to keep ordering and filter accuracy.
    void refetch();
  }

  const hasActiveFilters =
    debouncedSearch.length > 0 || businessType !== "all" || status !== "active";

  const cardHandlers = {
    canArchive,
    onEdit: handleEditClick,
    onArchive: handleArchive,
    onRestore: handleRestore,
  };

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">לקוחות</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ניהול הלקוחות של המשרד
          </p>
        </div>
        <Button onClick={handleCreateClick}>
          <Plus className="size-4" />
          לקוח חדש
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="חיפוש לפי שם, ח״פ, אימייל או טלפון"
            className="pr-9"
            maxLength={100}
          />
        </div>

        <Select
          value={businessType}
          onValueChange={(v) => setBusinessType(v as BusinessTypeFilter)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל סוגי העסק</SelectItem>
            {BUSINESS_TYPES.map((bt) => (
              <SelectItem key={bt} value={bt}>
                {BUSINESS_TYPE_LABELS[bt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">פעילים</SelectItem>
            <SelectItem value="archived">בארכיון</SelectItem>
            <SelectItem value="all">הכל</SelectItem>
          </SelectContent>
        </Select>

        {loading && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            טוען...
          </div>
        )}

        <div className="text-xs text-muted-foreground mr-auto">
          {items.length} לקוחות
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border border-border rounded-lg glass-card shadow-card overflow-hidden">
          <EmptyState hasFilters={hasActiveFilters} onAddClient={handleCreateClick} />
        </div>
      ) : (
        <>
          {/* Desktop: table (md and up). */}
          <div className="hidden md:block border border-border rounded-lg glass-card shadow-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם</TableHead>
                  <TableHead>סוג עסק</TableHead>
                  <TableHead>טלפון</TableHead>
                  <TableHead>אימייל</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/clients/${client.id}`}
                        className="hover:underline focus:underline focus:outline-none"
                      >
                        {client.name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatBusinessType(client.businessType)}</TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {client.phone ?? "—"}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {client.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      {client.isActive ? (
                        <Badge variant="secondary">פעיל</Badge>
                      ) : (
                        <Badge variant="outline">בארכיון</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ClientActionsMenu client={client} {...cardHandlers} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards (below md). Name, type, tappable
              phone/email, status and the actions menu — all in portrait. */}
          <div className="md:hidden space-y-3">
            {items.map((client) => (
              <ClientCard key={client.id} client={client} {...cardHandlers} />
            ))}
          </div>
        </>
      )}

      <ClientFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        initial={dialogTarget}
        onSaved={handleSaved}
      />
    </div>
  );
}

// Shared actions dropdown — used by both the desktop table row and the
// mobile card so view / edit / archive / restore behave identically.
function ClientActionsMenu({
  client,
  canArchive,
  onEdit,
  onArchive,
  onRestore,
}: {
  client: ClientDTO;
  canArchive: boolean;
  onEdit: (c: ClientDTO) => void;
  onArchive: (c: ClientDTO) => void;
  onRestore: (c: ClientDTO) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`פעולות עבור ${client.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/clients/${client.id}`}>
            <Eye className="size-4" />
            צפייה
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(client)}>
          <Pencil className="size-4" />
          ערוך
        </DropdownMenuItem>
        {canArchive && client.isActive && (
          <DropdownMenuItem onClick={() => onArchive(client)}>
            <Archive className="size-4" />
            העבר לארכיון
          </DropdownMenuItem>
        )}
        {canArchive && !client.isActive && (
          <DropdownMenuItem onClick={() => onRestore(client)}>
            <ArchiveRestore className="size-4" />
            שחזר מהארכיון
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Mobile row rendered as a self-contained card (portrait-friendly).
function ClientCard({
  client,
  canArchive,
  onEdit,
  onArchive,
  onRestore,
}: {
  client: ClientDTO;
  canArchive: boolean;
  onEdit: (c: ClientDTO) => void;
  onArchive: (c: ClientDTO) => void;
  onRestore: (c: ClientDTO) => void;
}) {
  return (
    <div className="rounded-lg border border-border glass-card shadow-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/clients/${client.id}`}
            className="font-medium hover:underline focus:underline focus:outline-none truncate block"
          >
            {client.name}
          </Link>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatBusinessType(client.businessType)}
          </p>
        </div>
        <ClientActionsMenu
          client={client}
          canArchive={canArchive}
          onEdit={onEdit}
          onArchive={onArchive}
          onRestore={onRestore}
        />
      </div>

      {(client.phone || client.email) && (
        <div className="mt-3 space-y-1.5 text-sm">
          {client.phone && (
            <a
              href={`tel:${client.phone}`}
              className="inline-flex items-center gap-2 text-foreground hover:text-primary"
              dir="ltr"
            >
              <Phone className="size-3.5 text-muted-foreground" />
              {client.phone}
            </a>
          )}
          {client.email && (
            <a
              href={`mailto:${client.email}`}
              className="flex items-center gap-2 text-foreground hover:text-primary break-all"
              dir="ltr"
            >
              <Mail className="size-3.5 text-muted-foreground shrink-0" />
              {client.email}
            </a>
          )}
        </div>
      )}

      <div className="mt-3">
        {client.isActive ? (
          <Badge variant="secondary">פעיל</Badge>
        ) : (
          <Badge variant="outline">בארכיון</Badge>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  hasFilters,
  onAddClient,
}: {
  hasFilters: boolean;
  onAddClient: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm text-muted-foreground">אין לקוחות התואמים לסינון.</p>
      </div>
    );
  }
  return (
    <div className="p-12 text-center">
      <div className="size-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <UserSquare2 className="size-6" />
      </div>
      <h2 className="font-semibold text-lg mb-2">עוד אין לקוחות במשרד</h2>
      <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
        הוסף את הלקוח הראשון כדי להתחיל לנהל פרטים, הערות, וקישור למשימות בעתיד.
      </p>
      <Button onClick={onAddClient}>
        <Plus className="size-4" />
        הוסף לקוח ראשון
      </Button>
    </div>
  );
}
