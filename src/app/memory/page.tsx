import { invalidateMemory } from "@/app/actions/task-actions";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { MemoryConsole } from "@/components/memory/memory-console";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getMemoryConsole } from "@/modules/queries/get-memory-console";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";

export default async function MemoryPage(props: { params?: Promise<{ lang?: string }> }) {
  const locale = resolveLocale((await props.params)?.lang);
  const dictionary = await getDictionary(locale);
  const t = dictionary.pages.memory;
  const workspace = await getDefaultWorkspace();
  const items = await getMemoryConsole(workspace.id);

  const itemsWithActions = items.map((item) => ({
    ...item,
    actions: (
      <form action={invalidateMemory.bind(null, item.id)}>
        <button type="submit" className="rounded-md border px-3 py-2 text-sm text-foreground">
          {t.invalidate}
        </button>
      </form>
    ),
  }));

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <MemoryConsole items={itemsWithActions} copy={dictionary.components.memoryConsole} />
      </div>
    </ControlPlaneShell>
  );
}
