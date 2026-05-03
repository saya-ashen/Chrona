import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-tight",
  {
    variants: {
      tone: {
        neutral: "border-border/70 bg-background text-muted-foreground",
        info: "border-primary-border bg-primary-soft text-primary",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        critical: "border-red-200 bg-red-50 text-red-700",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({ className, tone, ...props }: StatusBadgeProps) {
  return <span className={cn(statusBadgeVariants({ tone }), className)} {...props} />;
}
