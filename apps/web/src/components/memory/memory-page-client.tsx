"use client";

import { MemoryConsole } from "@/components/memory/memory-console";

type MemoryConsoleData = Array<{
  id: string;
  content: string;
  sourceType: string;
  scope: string;
  status: string;
  workspaceId: string;
  taskId: string | null;
  taskTitle: string | null;
  runLabel: string | null;
}>;

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
