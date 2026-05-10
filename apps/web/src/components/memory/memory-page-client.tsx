"use client";

import { MemoryConsole } from "@/components/memory/memory-console";

type MemoryConsoleData = Awaited<ReturnType<typeof import("@chrona/engine/modules/pages/get-memory-console").getMemoryConsole>>;

type MemoryPageClientProps = {
  workspaceId: string;
  initialData: MemoryConsoleData;
  copy: Parameters<typeof MemoryConsole>[0]["copy"];
};

export function MemoryPageClient({ initialData, copy }: MemoryPageClientProps) {
  return (
    <MemoryConsole
      items={initialData.map((item: MemoryConsoleData[number]) => ({
        ...item,
        actions: null,
      }))}
      copy={copy}
    />
  );
}
