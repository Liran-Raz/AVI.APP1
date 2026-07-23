"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Download,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Lock,
  MoreHorizontal,
  Upload,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, apiClient, type AttachmentDTO } from "@/lib/api-client";
import type { AttachmentCategoryValue, OfficeFolder } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/locale-provider";

// The reusable encrypted-files panel (DEV-032). One panel = one folder/scope:
// it lists files, uploads (when an uploadTarget + capability allow), toggles
// list/grid, downloads (browser navigation, cookie-auth), and archives. All I/O
// goes through apiClient.attachments.* — no Supabase in the client.

export type AttachmentScope =
  | { scope: "client"; clientId: string; category?: AttachmentCategoryValue }
  | { scope: "task"; taskId: string }
  | { scope: "office"; folder: OfficeFolder };

export type UploadTarget = {
  context: "client" | "office" | "task";
  contextId?: string;
  category: AttachmentCategoryValue;
};

type Props = {
  title: string;
  listScope: AttachmentScope;
  uploadTarget: UploadTarget | null; // null = read-only (aggregate/archive)
  canUpload: boolean;
  canArchive: boolean;
  perClient: boolean; // encryption pill wording
  routeNote?: React.ReactNode;
  // Resolve an uploader's user id → display name (from the page's member list).
  nameFor?: (userId: string | null) => string | null;
  // In the archive folder, the row action is "restore" instead of "archive".
  archivedView?: boolean;
};

const MAX_MB = 4; // R1a cap (Vercel path); R1b lifts to 25MB

const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.docx,.xlsx,.doc,.xls,.txt,.csv";

function scopeKey(s: AttachmentScope): string {
  return s.scope === "client"
    ? `client:${s.clientId}:${s.category ?? ""}`
    : s.scope === "task"
      ? `task:${s.taskId}`
      : `office:${s.folder}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type FileKind = { label: string; cls: string };

function fileKind(mime: string): FileKind {
  if (mime === "application/pdf")
    return { label: "PDF", cls: "bg-rose-500" };
  if (mime.startsWith("image/"))
    return { label: "IMG", cls: "bg-emerald-500" };
  if (
    mime.includes("spreadsheet") ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv"
  )
    return { label: "XLS", cls: "bg-teal-600" };
  if (mime.includes("word") || mime === "application/msword")
    return { label: "DOC", cls: "bg-blue-600" };
  return { label: "TXT", cls: "bg-slate-500" };
}

export function AttachmentsPanel({
  title,
  listScope,
  uploadTarget,
  canUpload,
  canArchive,
  perClient,
  routeNote,
  nameFor,
  archivedView = false,
}: Props) {
  const t = useT();
  const [items, setItems] = useState<AttachmentDTO[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useState<"list" | "grid">("list");
  const [reloadNonce, setReloadNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const key = scopeKey(listScope);
  const token = `${key}#${reloadNonce}`;
  // Derived loading keyed by the fetch token (avoids a synchronous setState in
  // the effect — react-hooks/set-state-in-effect). Re-fetches on a scope change
  // (key) OR an explicit reload() (nonce).
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const loading = loadedToken !== token;

  const showUpload = canUpload && uploadTarget !== null;

  const reload = () => setReloadNonce((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const params =
          listScope.scope === "client"
            ? {
                scope: "client" as const,
                clientId: listScope.clientId,
                category: listScope.category,
              }
            : listScope.scope === "task"
              ? { scope: "task" as const, taskId: listScope.taskId }
              : { scope: "office" as const, folder: listScope.folder };
        const res = await apiClient.attachments.list(params);
        if (!cancelled) setItems(res.items);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError)
          toast.error(t("storage.errorWithMessage", { message: err.message }));
        else {
          toast.error(t("common.unexpectedError"));
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoadedToken(token);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function uploadFiles(files: FileList | File[]) {
    if (!uploadTarget) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        if (file.size > MAX_MB * 1024 * 1024) {
          toast.error(t("storage.tooLarge", { name: file.name, mb: MAX_MB }));
          continue;
        }
        await apiClient.attachments.upload({
          file,
          context: uploadTarget.context,
          contextId: uploadTarget.contextId,
          category: uploadTarget.category,
        });
      }
      toast.success(t("storage.uploadedToast"));
      reload();
    } catch (err) {
      if (err instanceof ApiError)
        toast.error(t("storage.errorWithMessage", { message: err.message }));
      else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function toggleArchive(a: AttachmentDTO) {
    try {
      await apiClient.attachments.archive(a.id, a.archivedAt === null);
      toast.success(
        a.archivedAt === null
          ? t("storage.archivedToast")
          : t("storage.unarchivedToast"),
      );
      reload();
    } catch (err) {
      if (err instanceof ApiError)
        toast.error(t("storage.errorWithMessage", { message: err.message }));
      else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h3 className="text-sm font-bold flex items-center gap-2">
          {title}
          <span className="text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {items.length}
          </span>
        </h3>
        <span className="flex-1" />
        <div className="inline-flex bg-muted rounded-md p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label={t("storage.view.list")}
            aria-pressed={view === "list"}
            className={cn(
              "size-7 grid place-items-center rounded",
              view === "list"
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <ListIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            aria-label={t("storage.view.grid")}
            aria-pressed={view === "grid"}
            className={cn(
              "size-7 grid place-items-center rounded",
              view === "grid"
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1">
          <Lock className="size-3" />
          {perClient ? t("storage.enc.client") : t("storage.enc.office")}
        </span>
      </div>

      {routeNote}

      {showUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
          }}
          className={cn(
            "border border-dashed rounded-lg p-4 text-center flex flex-col items-center gap-2 mb-4 transition-colors",
            dragOver
              ? "border-primary bg-primary/10"
              : "border-primary/35 bg-primary/[0.04]",
          )}
        >
          {uploading ? (
            <Loader2 className="size-6 text-primary animate-spin" />
          ) : (
            <Upload className="size-6 text-primary" />
          )}
          <p className="text-sm font-medium">
            {t("storage.dropzone.main")}{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-primary font-bold underline"
              disabled={uploading}
            >
              {t("storage.dropzone.choose")}
            </button>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("storage.dropzone.hint", { mb: MAX_MB })}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
            }}
          />
        </div>
      )}

      {loading ? (
        <div className="py-10 grid place-items-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg glass-card p-8 text-center text-sm text-muted-foreground">
          {t("storage.empty")}
        </div>
      ) : (
        <ul
          className={cn(
            "list-none m-0 p-0",
            view === "grid"
              ? "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
              : "flex flex-col gap-2",
          )}
        >
          {items.map((a) => {
            const kind = fileKind(a.mimeType);
            const uploader = nameFor?.(a.uploadedBy) ?? null;
            const meta = [
              formatBytes(a.sizeBytes),
              uploader ? t("storage.uploadedBy", { name: uploader }) : null,
              formatWhen(a.createdAt),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={a.id}
                className={cn(
                  "group flex items-center gap-3 p-2.5 border border-border rounded-lg glass-card hover:border-primary/30 transition-colors",
                  view === "grid" &&
                    "flex-col items-stretch text-center relative pt-4",
                )}
              >
                <span
                  className={cn(
                    "flex-none rounded-lg grid place-items-center text-white text-[10px] font-bold",
                    kind.cls,
                    view === "grid" ? "size-12 mx-auto mb-1" : "size-9",
                  )}
                  aria-hidden
                >
                  {kind.label}
                </span>
                <div className={cn("min-w-0", view === "list" && "flex-1")}>
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      view === "list" && "truncate",
                    )}
                    title={a.fileName}
                  >
                    {a.fileName}
                  </div>
                  <div
                    className={cn(
                      "text-xs text-muted-foreground",
                      view === "list" && "truncate",
                    )}
                    dir="auto"
                  >
                    {meta}
                  </div>
                </div>
                <div
                  className={cn(
                    "flex gap-1 flex-none",
                    view === "grid" && "absolute top-2 start-2",
                  )}
                >
                  <a
                    href={apiClient.attachments.downloadUrl(a.id)}
                    className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t("storage.downloadFile", { name: a.fileName })}
                  >
                    <Download className="size-4" />
                  </a>
                  {canArchive && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground opacity-70 group-hover:opacity-100"
                          aria-label={t("storage.actionsFor", { name: a.fileName })}
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => toggleArchive(a)}>
                          {a.archivedAt === null && !archivedView ? (
                            <>
                              <Archive className="size-4" />
                              {t("storage.archive")}
                            </>
                          ) : (
                            <>
                              <ArchiveRestore className="size-4" />
                              {t("storage.unarchive")}
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
