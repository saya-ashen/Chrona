import { apiPage, pagePosition } from "../api-page";
import { modelUsage, budgetTimezone } from "../settings";
import { localDayKey } from "@chrona/domain/steward/local-day";
import { publicSystemTools, consumerInput, ackInput, withdrawalsInput } from "./tool-contract-declarations";
import { z } from "zod";
import { CallError, type Caller, type SystemModule } from "../module-calls";
import type { StewardPorts } from "../ports";
import { runtimeHealth } from "../runtime-health";
import { createProviderControl } from "../provider-channel";
import { activityRecords } from "../activity";
import { acknowledgeKernelFacts, factConsumer, readKernelFacts, selectFactConsumer, withdrawnKernelKeys } from "../notification-facts";
import { json, requireOwner } from "./shared";

async function consumer(ports: StewardPorts, workspaceId: string, caller: Caller, args: z.infer<typeof consumerInput>) {
  await requireOwner(ports.db, workspaceId, caller);
  return args.moduleId === undefined ? factConsumer(ports.db, workspaceId) : selectFactConsumer(ports.db, workspaceId, args.moduleId, ports.now());
}
async function usage(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
      const workspace = await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }), at = ports.now();
      const timezone = budgetTimezone(workspace.settings), date = localDayKey(at, timezone);
      const modules = await ports.db.module.findMany({ where: { workspaceId }, select: { id: true, name: true } });
      const usage = await modelUsage(ports.db, workspaceId, workspace.settings, at);
      const wakes = await ports.db.moduleInvocation.findMany({ where: { workspaceId, mode: "timer", status: { not: "deferred" }, createdAt: { gte: new Date(at.getTime() - 48 * 3600_000), lte: at } }, select: { targetModuleId: true, createdAt: true, target: true } });
      const identities = new Set([...usage.map(row => row.moduleId), ...wakes.map(row => row.targetModuleId)]);
      const items = [...identities].map(moduleId => {
        const triggered = wakes.filter(row => row.targetModuleId === moduleId && localDayKey(row.createdAt, timezone) === date);
        const spent = usage.find(row => row.moduleId === moduleId) ?? { module: triggered[0]?.target ?? "removed", calls: 0, inputTokens: 0, outputTokens: 0, unreportedCalls: 0 };
        return { moduleId, module: modules.find(row => row.id === moduleId)?.name ?? spent.module, calls: spent.calls, inputTokens: spent.inputTokens, outputTokens: spent.outputTokens, unreportedCalls: spent.unreportedCalls, wakes: triggered.length, date, timezone };
      });
      return json(apiPage(items, args, `usage:${workspaceId}:${date}`, row => row.moduleId ?? row.module));
}
async function runs(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
  const input = { cursor: args.cursor, limit: args.limit }, scope = `runs:${workspaceId}:${args.sessionId ?? ""}`;
  const position = pagePosition(input, scope);
  const ids = await ports.db.run.findMany({ where: { workspaceId, ...(args.sessionId ? { sessionId: String(args.sessionId) } : {}), ...(position.after ? { id: { gt: position.after } } : {}) }, orderBy: { id: "asc" }, take: position.limit + 1, select: { id: true } });
  return json(apiPage(await createProviderControl(ports, workspaceId).list(args.sessionId as string | undefined, ids.map(row => row.id)), input, scope, row => row.id));
}
async function records(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
  const scope = `records:${workspaceId}`, position = pagePosition(args, scope);
  const after = position.after ? { at: new Date(position.after.slice(0, 24)), id: position.after.slice(25) } : undefined;
  if (after && (Number.isNaN(after.at.getTime()) || !after.id)) throw new CallError("invalid", "Invalid record cursor");
  return json(apiPage((await activityRecords(ports, workspaceId, { after, ascending: true, limit: position.limit + 1 })).rows, args, scope, row => `${row.at}:${row.id}`));
}
/** Governed audit and finite facts only. Applications own wording, aggregation and delivery. */
export const activity: SystemModule = {
  name: "activity",
  description: "活动事实：受控审计记录和单个选定应用消费的内核事实；不组织页面或投递通知。",
  unrecorded: ["facts", "ack", "withdrawals"],
  tools: publicSystemTools.activity,
  async handle({ ports, workspaceId, caller }, name, args) {
    if (name === "runtime") return json(await runtimeHealth(ports, workspaceId));
    if (name === "runs") return runs(ports, workspaceId, args);
    if (name === "records") return records(ports, workspaceId, args);
    if (name === "usage") return usage(ports, workspaceId, args);
    if (name === "consumer") return json(await consumer(ports, workspaceId, caller, args as z.infer<typeof consumerInput>));
    if (name === "facts") return json(await readKernelFacts(ports.db, workspaceId, caller));
    if (name === "withdrawals") { const input = args as z.infer<typeof withdrawalsInput>; return json(await withdrawnKernelKeys(ports.db, workspaceId, caller, input.revision, input.keys)); }
    if (name === "ack") { const input = args as z.infer<typeof ackInput>; return json(await acknowledgeKernelFacts(ports.db, workspaceId, caller, input.revision, input.ids)); }
    throw new CallError("not_found", `activity.${name} not found`);
  },
};
