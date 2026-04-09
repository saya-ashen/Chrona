import { ControlPlaneShell } from "@/components/control-plane-shell";
import { MemoryConsole } from "@/components/memory/memory-console";
import { invalidateMemory } from "@/app/actions/task-actions";
import { getMemoryConsole } from "@/modules/queries/get-memory-console";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";

export default async function MemoryPage() {
  const workspace = await getDefaultWorkspace();
  const items = await getMemoryConsole(workspace.id);

  const itemsWithActions = items.map((item) => ({
    ...item,
    actions: (
      <form action={invalidateMemory.bind(null, item.id)}>
        <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
          Invalidate
        </button>
      </form>
    ),
  }));

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
          <p className="text-sm text-muted-foreground">
            Review active memory records and deactivate stale guidance when it no longer applies.
          </p>
        </div>
        <MemoryConsole items={itemsWithActions} />
      </div>
    </ControlPlaneShell>
  );
}
