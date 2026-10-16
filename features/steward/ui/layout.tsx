import type { ComponentProps, ReactNode } from "react";
import { Card, cn } from "@shared/ui";

export function PageColumn({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto grid w-full min-w-0 max-w-[1112px] gap-7 px-4 pt-6 pb-16 [overflow-wrap:anywhere]", className)} {...props} />;
}

export function Section({ title, count, action, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & { title: ReactNode; count?: number; action?: ReactNode }) {
  return <section className={cn("grid min-w-0 gap-3", className)} {...props}>
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{count}{action}</div>
    </header>
    {children}
  </section>;
}

/** Shared framing for steward lists, result articles and contextual panels. */
export function Surface({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={cn("min-w-0 gap-0 divide-y rounded-[10px] border bg-card py-0 shadow-none", className)} {...props} />;
}

export function InlineForm({ className, ...props }: ComponentProps<"form">) {
  return <form className={cn("grid min-w-0 grid-cols-1 items-end gap-2 min-[480px]:grid-cols-[minmax(0,1fr)_auto] [&>button]:w-fit [&>button]:shrink-0 [&>label]:min-w-0 [&>[role]]:col-span-full", className)} {...props} />;
}
