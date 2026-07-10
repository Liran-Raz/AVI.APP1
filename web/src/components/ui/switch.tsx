"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // Track is w-9 (36px), thumb size-4 (16px), 1px border each side →
          // 18px of travel. `translate-x` is PHYSICAL, and the thumb's off
          // position is direction-dependent (left in LTR, right in RTL), so the
          // "on" transform must be DIRECTION-SCOPED — otherwise it slides the
          // wrong way and overflows the track (the DEV-018 RTL bug).
          "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=unchecked]:translate-x-0 ltr:data-[state=checked]:translate-x-[18px] rtl:data-[state=checked]:-translate-x-[18px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
