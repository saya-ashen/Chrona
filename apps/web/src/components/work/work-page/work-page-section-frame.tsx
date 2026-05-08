import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type WorkPageSectionFrameProps = {
  title: string;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export function WorkPageSectionFrame({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: WorkPageSectionFrameProps) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-border/70 bg-card p-4 shadow-[0_14px_36px_rgba(15,23,42,0.05)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[1.1rem] font-semibold text-foreground">{title}</h3>
        {actions}
      </div>
      <div className={cn("mt-3 min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
