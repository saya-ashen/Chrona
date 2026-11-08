import { z } from "zod";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { admitted, callSync, CallError, type Caller } from "./module-calls";
import { moduleTools, catalogEntry } from "./module-tools";
import { assertExecutionPrincipal } from "./execution-principal";

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
    if (!await admitted(ports.db, caller, entry.tool)) throw new CallError("forbidden", `Agent caller cannot use ${target}`);
    selected.push(entry);
  }
  return { caller, entries: selected, catalog: selected.map(catalogEntry), runId: undefined as string | undefined, workspaceId: principal.workspaceId };
}
export async function contextRunTools(ports: StewardPorts, run: { id: string; sessionId: string | null; workspaceId: string }) {
  if (!run.sessionId) return null;
  const grant = await ports.db.audit.findUnique({ where: { id: `agent-context:${run.sessionId}` } });
  if (!grant) return null;
  const hash = z.object({ hash: z.string() }).parse(grant.details).hash;
  const session = await ports.db.session.findFirstOrThrow({ where: { id: run.sessionId, workspaceId: run.workspaceId, source: "module" } });
  if (!session.moduleId) throw new CallError("forbidden", "Agent context owner is missing");
  const principal: ExecutionPrincipal = { workspaceId: run.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: session.moduleId, hash } };
  await assertExecutionPrincipal(ports.db, principal);
  const tools = await ports.db.audit.findUniqueOrThrow({ where: { id: `agent-tools:${run.id}` } });
  const { targets } = z.object({ targets: z.array(z.string()).max(100) }).parse(tools.details);
  return { ...await selectContextTools(ports, principal, targets), runId: run.id };
}
export async function callContextTool(ports: StewardPorts, context: NonNullable<Awaited<ReturnType<typeof contextRunTools>>>, name: string, raw: unknown, deadline: number) {
  const entry = context.entries.find(entry => entry.name === name);
  if (!entry) throw new CallError("forbidden", "Tool is outside the module's Agent run selection");
  const result = await callSync(ports, { workspaceId: context.workspaceId, caller: context.caller, chain: [], path: [], deadline, run: { executionRunId: context.runId } }, `${entry.module.name}.${entry.tool.name}`, raw);
  return { result: result.output };
}
