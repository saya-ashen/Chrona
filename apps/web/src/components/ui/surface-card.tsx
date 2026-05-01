import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SurfaceCardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "aside" | "header";
  variant?: "default" | "inset" | "highlight";
  padding?: "sm" | "md" | "lg";
};

const variantClasses = {
  default: "border-border/60 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.06)]",
  inset: "border-border/60 bg-background/80 shadow-none",
  highlight: "border-primary/15 bg-white/92 shadow-[0_12px_32px_rgba(79,70,229,0.12)] ring-1 ring-primary/10 backdrop-blur",
} as const;

const paddingClasses = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
} as const;

export function SurfaceCard({
  as = "section",
  className,
  variant = "default",
  padding = "md",
  ...props
}: SurfaceCardProps) {
  const Comp = as;

  return (
    <Comp
      className={cn(
        "rounded-3xl border text-foreground",
        variantClasses[variant],
        paddingClasses[padding],
        className,
      )}
      {...props}
    />
  );
}

export function SurfaceCardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1.5", className)} {...props} />;
}

export function SurfaceCardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-semibold tracking-tight text-foreground", className)} {...props} />;
}

export function SurfaceCardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
