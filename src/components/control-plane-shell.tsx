import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/modules/ui/navigation";

type ControlPlaneShellProps = {
  children: ReactNode;
};

export function ControlPlaneShell({ children }: ControlPlaneShellProps) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(15,23,42,0.03),transparent_22%),linear-gradient(135deg,rgba(59,130,246,0.05),transparent_35%),linear-gradient(225deg,rgba(168,85,247,0.04),transparent_30%)] bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/schedule" aria-label="Agent Dashboard" className="space-y-0.5">
            <span className="block text-base font-semibold tracking-tight">Agent Dashboard</span>
            <span className="block text-xs text-muted-foreground">Task-centric AI control plane</span>
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-1.5 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
