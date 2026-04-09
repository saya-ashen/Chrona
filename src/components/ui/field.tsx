import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const inputClassName =
  "min-h-10 rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/10";

export const textareaClassName = cn(inputClassName, "py-3");
export const selectClassName = cn(inputClassName, "appearance-none");

type FieldProps = {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, hint, className, children }: FieldProps) {
  return (
    <label className={cn("grid gap-1.5 text-sm text-foreground", className)}>
      <span className="font-medium">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {children}
    </label>
  );
}
