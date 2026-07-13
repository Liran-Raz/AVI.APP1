"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// A responsive modal: a bottom-sheet on mobile (slides up, rounded top, full-width),
// a centered card on sm+. Built on Radix Dialog primitives directly so its positioning
// classes are fully owned here (no twMerge conflicts with the shared DialogContent).
// Header (icon + title + close) and an optional sticky footer are provided; the body
// scrolls between them. RTL: the close button sits at the inline-end (visual left).
export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  icon,
  footer,
  children,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  dismissible?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          className={cn(
            "fixed z-50 flex flex-col border border-border bg-background shadow-xl outline-none",
            // mobile — bottom sheet
            "inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2",
            "duration-200",
            // sm+ — centered card
            "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-md",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:max-h-[85vh]",
          )}
        >
          <div className="flex items-center gap-2 px-5 pt-5 pb-3">
            {icon}
            <DialogPrimitive.Title className="text-lg font-bold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="ms-auto rounded-md p-1 text-muted-foreground opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="סגירה"
            >
              <XIcon className="size-5" />
            </DialogPrimitive.Close>
          </div>
          {/* sr-only description keeps Radix from warning about a missing aria-describedby */}
          <DialogPrimitive.Description className="sr-only">
            {title}
          </DialogPrimitive.Description>

          <div className="flex-1 overflow-y-auto px-5 pb-2">{children}</div>

          {footer ? (
            <div className="shrink-0 border-t border-border px-5 py-4">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
