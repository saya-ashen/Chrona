import type { ReactNode } from "react";

type MemoryConsoleProps = {
  items: Array<{
    id: string;
    content: string;
    sourceType: string;
    scope: string;
    status: string;
    taskTitle: string | null;
    runLabel: string | null;
    actions?: ReactNode;
  }>;
};

export function MemoryConsole({ items }: MemoryConsoleProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <section key={item.id} className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{item.content}</p>
            <p>Source: {item.sourceType}</p>
            <p>Scope: {item.scope}</p>
            <p>Status: {item.status}</p>
            <p>Task: {item.taskTitle ?? "-"}</p>
            <p>Run: {item.runLabel ?? "-"}</p>
          </div>
          <div className="mt-4">{item.actions ?? <button type="button" className="rounded-md border px-3 py-2 text-sm text-foreground">Invalidate</button>}</div>
        </section>
      ))}
    </div>
  );
}
