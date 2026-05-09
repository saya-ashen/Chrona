"use client";

import { MemoryConsole } from "@/components/memory/memory-console";

type MemoryPageClientProps = {
  workspaceId: string;
  initialData: Awaited<ReturnType<typeof import("@/modules/queries/get-memory-console").getMemoryConsole>>;
  copy: Parameters<typeof MemoryConsole>[0]["copy"];
};

export function MemoryPageClient({ initialData, copy }: MemoryPageClientProps) {
  return (
    <MemoryConsole
      items={initialData.map((item) => ({
        ...item,
        actions: null,
      }))}
      copy={copy}
    />
  );
}
