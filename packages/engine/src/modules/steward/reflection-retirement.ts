import { z } from "zod";
import type { StewardPorts } from "./ports";
import { setModuleSettings, settingsView } from "./module-overview";
import { CallError, callSync, kernelOrigin } from "./module-calls";
import { latestModuleEvolution } from "./module-evolution";
import { notifyLifecycle } from "./notify-user";
import { cancelProviderRun } from "./provider-cancel";

const suggestionSchema = z.object({ key: z.string(), title: z.string(), sessionId: z.string(), modules: z.array(z.string()) });
type Note = (ports: StewardPorts, workspaceId: string, args: Record<string, string>) => Promise<unknown>;
const note: Note = async (ports, workspaceId, args) => {
  const result = await callSync(ports, kernelOrigin(workspaceId), "mind.note", args, { timeoutMs: 10_000 });
  if (z.object({ error: z.string() }).safeParse(result.output).success) throw new Error("mind.note rejected migration");
  return result.output;
};
async function sourceArgs(ports: StewardPorts, workspaceId: string, suggestion: z.infer<typeof suggestionSchema>): Promise<Record<string, string>> {
  const name = suggestion.modules[0];
  if (!name) return {};
  const module = await ports.db.module.findFirst({ where: { workspaceId, OR: [{ id: name }, { name }] } });
  if (!module?.activeHash) return {};
  const activation = await latestModuleEvolution(ports.db, workspaceId, module.id, module.activeHash);
  if (!activation) return {};
  return { "source-module-id": module.id, "source-activation-id": activation.activationId, topic: `reflection:${suggestion.key}`.replace(/[^\w:.-]/g, "_").slice(0, 80) };
}
async function migrateLedger(ports: StewardPorts, workspaceId: string, writeNote: Note) {
  const rows = await ports.db.audit.findMany({ where: { workspaceId, kind: "reflection_suggested", createdAt: { gte: new Date(ports.now().getTime() - 30 * 86400_000) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let count = 0;
  for (const row of rows) {
    try {
      const suggestion = suggestionSchema.parse(row.details);
      await writeNote(ports, workspaceId, { title: `反思建议：${suggestion.title}`.slice(0, 120), status: "done",
        conclusion: `已移除的主动反思于 ${row.createdAt.toISOString().slice(0, 10)} 发起构建（会话 ${suggestion.sessionId}）；迁移记录，不代表已修复`,
        "build-session-id": suggestion.sessionId, ...await sourceArgs(ports, workspaceId, suggestion) });
      count++;
    } catch {
      console.error(JSON.stringify({ event: "reflection_retirement_note_failed", workspaceId, auditId: row.id }));
    }
  }
  return count;
}
async function cancelReflectRuns(ports: StewardPorts, workspaceId: string) {
  const runs = await ports.db.run.findMany({ where: { workspaceId, status: { in: ["queued", "running"] }, session: { source: "reflect" } } });
  for (const run of runs) await cancelProviderRun(ports, workspaceId, run.id);
  return runs.length;
}

function oldReflectionEnabled(settings: unknown) {
  const raw = z.object({ reflection: z.object({ enabled: z.unknown().optional() }).nullish() }).safeParse(settings).data?.reflection?.enabled;
  return typeof raw === "boolean" ? raw : true;
}
async function activeMindSettings(ports: StewardPorts, workspaceId: string) {
  // This one-off built-in takeover migration intentionally names mind.
  const module = await ports.db.module.findFirst({ where: { workspaceId, name: "mind", status: "active", activeHash: { not: null } } });
  if (!module) return null;
  return settingsView(ports, workspaceId, "mind").catch(error => {
    if (error instanceof CallError && error.code === "not_found") return null;
    throw error;
  });
}
async function transferPreferences(ports: StewardPorts, workspaceId: string, reflection: boolean) {
  const settings = await activeMindSettings(ports, workspaceId), values = settings?.values;
  const mind = values ? (values.enabled === false ? "disabled" : "enabled") : "absent";
  let healthFixes = settings?.declarations["health-fixes"] ? values?.["health-fixes"] === true : null;
  if (!reflection && mind === "enabled" && healthFixes !== null) {
    await setModuleSettings(ports, workspaceId, "mind", { "health-fixes": false });
    healthFixes = false;
  }
  return { mind, healthFixes, hasMind: !!values };
}

/** Retain historical evidence, stop old reflection attempts, and conservatively transfer preferences once. */
export async function retireReflection(ports: StewardPorts, workspaceId: string, writeNote: Note = note) {
  const id = `reflection-retired:${workspaceId}`;
  if (await ports.db.audit.findUnique({ where: { id } })) return;
  const workspace = await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const reflection = oldReflectionEnabled(workspace.settings);
  const { mind, healthFixes, hasMind } = await transferPreferences(ports, workspaceId, reflection);
  const cancelledRuns = await cancelReflectRuns(ports, workspaceId);
  const ledger = hasMind ? await migrateLedger(ports, workspaceId, writeNote) : 0;
  const notify = !reflection && mind === "enabled" || reflection && mind !== "enabled";
  await ports.db.$transaction(async tx => {
    if (notify) await notifyLifecycle(tx, ports, workspaceId, id, { kind: "reflection-retired", reflection, mind, healthFixes });
    await tx.audit.create({ data: { id, workspaceId, kind: "reflection_retired", actorKey: "chrona", subjectId: workspaceId,
      details: { reflection, mind, healthFixes, ledger, cancelledRuns } } });
  });
}
