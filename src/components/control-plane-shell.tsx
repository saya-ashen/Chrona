import type { ReactNode } from "react";
import Link from "next/link";
import { NAV_ITEMS } from "@/modules/ui/navigation";

type ControlPlaneShellProps = {
  children: ReactNode;
};

export function ControlPlaneShell({ children }: ControlPlaneShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/workspaces" className="text-sm font-semibold tracking-tight">
            Agent Dashboard
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
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
