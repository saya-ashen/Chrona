import { z } from "zod";
import type { RoutedTarget } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { admitted, callSync, CallError, type Caller, type CallOrigin } from "../modules/module-calls";
import { moduleTools, catalogEntry } from "../modules/module-tools";
import { assertApprovedAgentPrincipal, type ModulePrincipal } from "./agent-context-state";
import { runExpired } from "../execution/run-finish";

import { withAgentContextEntry } from "./agent-context-entry";

/** Select only interfaces that the originating module itself can call. No Provider or owner upgrade. */
export async function selectContextTools(ports: StewardPorts, principal: ModulePrincipal, targets: RoutedTarget[]) {
  const module = await ports.db.module.findUniqueOrThrow({ where: { id: principal.caller.moduleId }, select: { name: true } });
  const caller = { ...principal.caller, module: module.name } satisfies Caller;
  const entries = [...await moduleTools(ports, { workspaceId: principal.workspaceId, audience: "modules" }), ...await moduleTools(ports, {
    workspaceId: principal.workspaceId, audience: "owner" })];
  const selected = [] as typeof entries;
  const names = new Set<string>();
  for (const target of targets) {
    const entry = entries.find(entry => typeof target === "string" ? `${entry.module.name}.${entry.tool.name}` === target : entry.module.id === target.moduleId && entry.tool.name === target.tool);
    if (!entry) throw new CallError("not_found", `Agent tool ${target} not found`);
    if (entry.module.name === "secrets" || !await admitted(ports.db, caller, entry.tool, principal.workspaceId, entry.module)) throw new CallError("forbidden", `Agent caller cannot use ${target}`);
    // Explicit Run selections must be callable without workspace focus or tool search.
    if (names.has(entry.name)) continue;
    names.add(entry.name);
    selected.push({ ...entry, direct: true });
  }
  return { caller, entries: selected, catalog: selected.map(catalogEntry), runId: undefined as string | undefined, workspaceId: principal.workspaceId };
}
export async function contextRunTools(ports: StewardPorts, run: { id: string; sessionId: string | null; workspaceId: string }) {
  if (!run.sessionId) return null;
  const context = await ports.db.agentContext.findFirst({ where: { id: run.sessionId, workspaceId: run.workspaceId } });
  if (!context) return null;
  const { hash, moduleId, ownerId } = context;
  if (!moduleId) throw new CallError("forbidden", "Agent context owner is missing");
  const principal: ModulePrincipal = { workspaceId: run.workspaceId, ownerId, caller: { kind: "module", moduleId, hash } };
  await assertApprovedAgentPrincipal(ports.db, principal, false);
  const tools = await ports.db.agentRunAdmission.findFirst({ where: { runId: run.id, moduleId, hash } });
  if (!tools) return null;
  const { targets } = z.object({ targets: z.array(z.object({ target: z.string(), moduleId: z.string(),
    contractHash: z.string().optional() }).strict()).max(100) }).parse(tools);
  const selected = await selectContextTools(ports, principal, targets.map(item => item.target));
  for (const entry of selected.entries) {
    const bound = targets.find(item => item.target === `${entry.module.name}.${entry.tool.name}`)!;
    if (entry.module.id !== bound.moduleId) throw new CallError("conflict", "Admitted Run tool identity changed");
  }
  return { ...selected, runId: run.id };
}
export type RunToolDelegate = { caller: Extract<Caller, { kind: "module" }>; hash: string; active(): boolean };

export async function callContextTool(ports: StewardPorts, context: NonNullable<Awaited<ReturnType<typeof contextRunTools>>>, name: string,
  raw: unknown, { deadline, key, delegate }: { deadline: number; key?: string; delegate?: RunToolDelegate }) {
  const now = ports.now();
  async function liveRun() {
    const run = context.runId && context.workspaceId ? await ports.db.run.findFirst({ where: { id: context.runId,
      workspaceId: context.workspaceId, status: "running" } }) : null;
    if (!run || runExpired(run, ports.now()) || run.cancelRequestedAt || delegate && !delegate.active()) {
      throw new CallError("forbidden", "Agent run is no longer active");
    }
    return run;
  }
  const run = await liveRun();
  const current = await contextRunTools(ports, run);
  if (!current || current.caller.moduleId !== context.caller.moduleId || current.caller.hash !== context.caller.hash ||
    current.caller.module !== context.caller.module) throw new CallError("forbidden", "Agent context caller changed");
  const entry = current.entries.find(entry => entry.name === name);
  if (!entry) throw new CallError("forbidden", "Tool is outside the module's Agent run selection");
  if (delegate && entry.module.activeHash !== delegate.hash) throw new CallError("conflict", "Admitted Run tool version changed");
  const origin: CallOrigin = { workspaceId: current.workspaceId, caller: current.caller, chain: [], path: [],
    deadline: run.deadlineAt ? Math.min(deadline, run.deadlineAt.getTime()) : deadline, run: { executionRunId: run.id },
    beforeDelivery: async () => {
      await liveRun();
      if (deadline <= ports.now().getTime()) throw new CallError("unavailable", "Tool call deadline ended");
      if (delegate) await assertApprovedAgentPrincipal(ports.db, { workspaceId: current.workspaceId, ownerId: "owner", caller: delegate.caller }, false);
    } };
  if (delegate) origin.delegate = delegate.caller;
  return withAgentContextEntry(ports, origin, async () => {
    const result = await callSync(ports, origin, `${entry.module.name}.${entry.tool.name}`, raw, { key,
      timeoutMs: Math.max(1, (origin.deadline ?? deadline) - now.getTime()),
      expectedTarget: { moduleId: entry.module.id, ...(delegate ? { hash: delegate.hash } : {}) } });
    return { result: result.output };
  });
}
