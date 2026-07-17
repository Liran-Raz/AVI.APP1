"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { Flag } from "@/components/i18n/flag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOCALE_NATIVE_NAME,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import { ApiError, apiClient } from "@/lib/api-client";

// Shared: persist the chosen locale, then refresh so the server layout
// re-renders with the new dir/lang/catalog. Returns a busy flag + setter.
function useSetLocale() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function setLocale(locale: Locale) {
    setSaving(true);
    try {
      await apiClient.locale.set({ locale });
      // Re-runs the server layout → new <html dir/lang> + catalog flows into
      // the provider, and useLocale() updates this control to the new value.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error("Something went wrong");
    } finally {
      // MUST reset here: router.refresh() re-renders SERVER components but
      // this CLIENT control keeps its state (it does not remount), so leaving
      // saving=true would freeze the switcher until a hard reload.
      setSaving(false);
    }
  }

  return { saving, setLocale };
}

// Dropdown-select variant — for the Settings header and the mobile drawer.
export function LanguageSelect({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const { saving, setLocale } = useSetLocale();

  return (
    <Select
      value={locale}
      onValueChange={(v) => setLocale(v as Locale)}
      disabled={saving}
    >
      <SelectTrigger className={className} aria-label={t("language.label")}>
        {/* SelectValue renders the SELECTED item's content — i.e. its flag +
            name — so the trigger already shows the current flag. Do NOT add a
            second <Flag> here or it doubles up. */}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((l) => (
          <SelectItem key={l} value={l}>
            <span className="flex items-center gap-2">
              <Flag locale={l} />
              {LOCALE_NATIVE_NAME[l]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Compact flag menu — for the desktop topbar. The trigger shows the CURRENT
// language's flag; the dropdown lists each language with its flag. Its own
// dropdown (not nested in another menu), so no portal/focus conflicts.
export function LanguageMenu() {
  const t = useT();
  const locale = useLocale();
  const { saving, setLocale } = useSetLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("language.title")}
          className="flex items-center p-1.5 rounded-md hover:bg-accent"
        >
          <Flag locale={locale} className="h-4 w-[22px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LOCALES.map((l) => (
          <DropdownMenuItem
            key={l}
            disabled={saving}
            onClick={() => l !== locale && setLocale(l)}
          >
            <Flag locale={l} />
            <span className="flex-1">{LOCALE_NATIVE_NAME[l]}</span>
            {l === locale ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
