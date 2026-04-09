import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-1 text-[12px] font-semibold tracking-[0.125px] w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-border bg-[var(--color-badge-blue-bg)] text-[var(--color-focus-blue)]",
        secondary:
          "border-border bg-[var(--color-warm-white)] text-[var(--color-warm-gray-500)]",
        destructive:
          "border-border bg-destructive text-white focus-visible:ring-destructive/20",
        outline:
          "border-border bg-transparent text-foreground [a&]:hover:bg-black/5",
        neon:
          "border-border bg-[var(--color-badge-blue-bg)] text-[var(--color-focus-blue)]",
        forest:
          "border-border bg-[rgba(26,174,57,0.15)] text-[#1aae39]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
