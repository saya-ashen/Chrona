"use client";

import { startTransition, useCallback, useState } from "react";
import { invalidateMemory } from "@/lib/task-actions-client";
import { MemoryConsole } from "@/components/memory/memory-console";

type MemoryPageClientProps = {
  workspaceId: string;
  initialData: Awaited<ReturnType<typeof import("@/modules/queries/get-memory-console").getMemoryConsole>>;
  copy: Parameters<typeof MemoryConsole>[0]["copy"];
};

export function MemoryPageClient({ workspaceId, initialData, copy }: MemoryPageClientProps) {
  const [items, setItems] = useState(initialData);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/memory/projection?workspaceId=${encodeURIComponent(workspaceId)}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const next = await response.json();
    startTransition(() => setItems(next));
  }, [workspaceId]);

  return (
    <MemoryConsole
      items={items.map((item) => ({
        ...item,
        actions: (
          <form onSubmit={async (event) => { event.preventDefault(); await invalidateMemory(item.id); await refresh(); }}>
            <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
              {copy?.invalidate ?? "Invalidate"}
            </button>
          </form>
        ),
      }))}
      copy={copy}
    />
  );
}
