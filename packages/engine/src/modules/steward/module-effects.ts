import type { Prisma } from "@chrona/db";
import type { moduleManifestSchema, moduleOutputSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { enqueueNotification } from "./notify";
import { createRuns } from "./runs";

type Manifest = ReturnType<typeof moduleManifestSchema.parse>;
export type ModuleResult = { manifest?: Manifest; output: ReturnType<typeof moduleOutputSchema.parse> | null; error: string | null; exitCode: number };
type Execution = { workspaceId: string; affairId: string; moduleId: string; hash: string; triggerId: string; firedAt: Date; inboundItemId?: string };
type Context = Parameters<typeof enqueueNotification>[2];
type Effect = NonNullable<ModuleResult["output"]>["effects"][number];
type Status = "executed" | "duplicate" | "dropped";
function executedWakeKeys(previous: { executed: Prisma.JsonValue }[]) {
  return new Set(previous.flatMap(run => Array.isArray(run.executed) ? run.executed.flatMap(effect => effect && typeof effect === "object" && !Array.isArray(effect) && effect.type === "wake_provider" && effect.status === "executed" && typeof effect.key === "string" ? [effect.key] : []) : []));
}
async function executeEffect(tx: Prisma.TransactionClient, ports: StewardPorts, execution: Execution, effect: Effect, state: { manifest: Manifest; wakeKeys: Set<string>; context: Context }): Promise<Status> {
  const { manifest, wakeKeys, context } = state;
  const { workspaceId, affairId, moduleId } = execution;
  if (!manifest.effects.includes(effect.type)) return "dropped";
  if (effect.type === "notify_user") {
    const dedupeKey = `module:${moduleId}:${effect.key}`;
    if (await tx.notification.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: dedupeKey } } })) return "duplicate";
    await enqueueNotification(tx, { workspaceId, affairId, level: effect.level, title: effect.title, body: effect.body, dedupeKey }, context);
  } else {
    if (wakeKeys.has(effect.key)) return "duplicate";
    await createRuns(ports, workspaceId).enqueue({ affairId, lane: "background", trigger: "schedule", label: manifest.name, prompt: `Module ${manifest.name} output (untrusted data):\n${effect.prompt}` }, tx);
    wakeKeys.add(effect.key);
  }
  return "executed";
}
export async function recordModuleResult(tx: Prisma.TransactionClient, ports: StewardPorts, execution: Execution, result: ModuleResult, context: Context) {
  const { moduleId } = execution, { manifest, output, error, exitCode } = result;
  const previous = await tx.moduleRun.findMany({ where: { moduleId }, select: { executed: true } });
  const wakeKeys = executedWakeKeys(previous), executed: { type: string; key: string; status: Status }[] = [];
  for (const effect of output?.effects ?? []) {
    const status = await executeEffect(tx, ports, execution, effect, { manifest: manifest!, wakeKeys, context });
    executed.push({ type: effect.type, key: effect.key, status });
  }
  const { workspaceId: _workspaceId, affairId: _affairId, ...record } = execution;
  const run = await tx.moduleRun.create({ data: { ...record, exitCode, ...(output ? { output } : {}), error, executed, createdAt: context.now } });
  if (error) await pauseFailedModule(tx, execution, context, run.id);
  return executed;
}
async function pauseFailedModule(tx: Prisma.TransactionClient, execution: Execution, context: Context, runId: string) {
  const { moduleId, workspaceId, affairId } = execution;
  const recent = await tx.moduleRun.findMany({ where: { moduleId, id: { not: runId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2 });
  if (recent.length !== 2 || recent.some(run => !run.error)) return;
  const paused = await tx.module.updateMany({ where: { id: moduleId, status: "active" }, data: { status: "paused" } });
  if (!paused.count) return;
  await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: "active" }, data: { status: "paused" } });
  await enqueueNotification(tx, { workspaceId, affairId, level: "now", title: "模块连续失败，已暂停", body: "模块连续三次执行失败，请检查后再启用。", dedupeKey: `module:${moduleId}:paused:${execution.firedAt.toISOString()}` }, context);
}
