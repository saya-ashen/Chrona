import { z } from "zod";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { admitted, callSync, CallError, type Caller, type CallOrigin } from "./module-calls";
import { moduleTools, catalogEntry } from "./module-tools";
import { assertExecutionPrincipal } from "./execution-principal";
import { providerCancelKey } from "./provider-journal";

import { withAgentContextEntry } from "./agent-context-entry";

/** Select only interfaces that the originating module itself can call. No Provider or owner upgrade. */
export async function selectContextTools(ports: StewardPorts, principal: ExecutionPrincipal, targets: string[]) {
  if (principal.caller.kind !== "module") throw new CallError("forbidden", "Agent contexts require a module caller");
  const module = await ports.db.module.findUniqueOrThrow({ where: { id: principal.caller.moduleId }, select: { name: true } });
  const caller = { ...principal.caller, module: module.name } satisfies Caller;
  const entries = [...await moduleTools(ports, { workspaceId: principal.workspaceId, audience: "modules" }), ...await moduleTools(ports, { workspaceId: principal.workspaceId, audience: "owner" })];
  const selected = [] as typeof entries;
  for (const target of new Set(targets)) {
    const entry = entries.find(entry => `${entry.module.name}.${entry.tool.name}` === target);
    if (!entry) throw new CallError("not_found", `Agent tool ${target} not found`);
    if (!await admitted(ports.db, caller, entry.tool, principal.workspaceId)) throw new CallError("forbidden", `Agent caller cannot use ${target}`);
    selected.push(entry);
  }
  return { caller, entries: selected, catalog: selected.map(catalogEntry), runId: undefined as string | undefined, workspaceId: principal.workspaceId };
}
export async function contextRunTools(ports: StewardPorts, run: { id: string; sessionId: string | null; workspaceId: string }) {
  if (!run.sessionId) return null;
  const grant = await ports.db.audit.findFirst({ where: { id: `agent-context:${run.sessionId}`, workspaceId: run.workspaceId, kind: "agent_context", subjectId: run.sessionId } });
  if (!grant) return null;
  const hash = z.object({ hash: z.string() }).parse(grant.details).hash;
  const session = await ports.db.session.findFirstOrThrow({ where: { id: run.sessionId, workspaceId: run.workspaceId, source: "module" } });
  if (!session.moduleId || grant.actorKey !== session.moduleId) throw new CallError("forbidden", "Agent context owner is missing");
  const principal: ExecutionPrincipal = { workspaceId: run.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: session.moduleId, hash } };
  await assertExecutionPrincipal(ports.db, principal);
  const tools = await ports.db.audit.findFirstOrThrow({ where: { id: `agent-tools:${run.id}`, workspaceId: run.workspaceId, kind: "agent_tools", subjectId: run.id, actorKey: session.moduleId } });
  const { targets } = z.object({ targets: z.array(z.string()).max(100) }).parse(tools.details);
  return { ...await selectContextTools(ports, principal, targets), runId: run.id };
}
export async function callContextTool(ports: StewardPorts, context: NonNullable<Awaited<ReturnType<typeof contextRunTools>>>, name: string, raw: unknown, deadline: number) {
  const now = ports.now();
  const run = context.runId && context.workspaceId ? await ports.db.run.findFirst({ where: { id: context.runId, workspaceId: context.workspaceId, status: "running", execution: null, deadlineAt: { gt: now }, leaseUntil: { gt: now } } }) : null;
  if (!run || await ports.db.audit.findUnique({ where: { id: providerCancelKey(run.id) } })) throw new CallError("forbidden", "Agent run is no longer active");
  const current = await contextRunTools(ports, run);
  if (!current || current.caller.moduleId !== context.caller.moduleId || current.caller.hash !== context.caller.hash || current.caller.module !== context.caller.module) throw new CallError("forbidden", "Agent context caller changed");
  const entry = current.entries.find(entry => entry.name === name);
  if (!entry) throw new CallError("forbidden", "Tool is outside the module's Agent run selection");
  const origin: CallOrigin = { workspaceId: current.workspaceId, caller: current.caller, chain: [], path: [], deadline: Math.min(deadline, run.deadlineAt!.getTime()), run: { executionRunId: run.id } };
  return withAgentContextEntry(ports, origin, async () => {
    const result = await callSync(ports, origin, `${entry.module.name}.${entry.tool.name}`, raw);
    return { result: result.output };
  });
}
