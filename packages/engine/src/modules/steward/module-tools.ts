import { randomUUID } from "node:crypto";
import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { ModuleTool } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";
import { moduleSupervisor } from "./module-supervisor";
import { audit } from "./audit";
import { recordModuleOutputMismatch } from "./module-diagnostics";
import { currentModuleEvolution } from "./module-evolution";
import { CallError, callSync, checkModuleOutput, listSystemModules, moduleOutputError, normalizedToolInputSchema, validateToolArgs, type SystemTool } from "./module-calls";

/** Tools belong to the workspace; session focus controls only catalog exposure. `audience` is who will call them. */
type Scope = { workspaceId: string; sessionId?: string | null; audience?: "provider" | "owner" };
type Entry = { name: string; module: { id: string; name: string; activeHash: string | null }; manifest: { description?: string; tools: (SystemTool | ModuleTool)[] }; tool: SystemTool | ModuleTool; direct: boolean; system?: true };
/** Chrona's own interfaces visible to the audience (v2-13): always direct, few, and part of how the Provider works. */
function systemEntries(audience: "provider" | "owner"): Entry[] {
  return listSystemModules().flatMap(system => {
    const visible = system.tools.filter(tool => tool.visibility.includes(audience));
    return visible.map(tool => ({ name: `m_${system.name}_${tool.name.replaceAll("-", "_")}`, module: { id: `system:${system.name}`, name: system.name, activeHash: "system" },
      manifest: { tools: visible }, tool, direct: true, system: true as const }));
  });
}
async function addModuleTools(ports: StewardPorts, modules: Awaited<ReturnType<StewardPorts["db"]["module"]["findMany"]>>, audience: "provider" | "owner", focus: unknown[], catalog: { tools: Entry[]; names: Set<string>; toolsets: Set<string> }) {
  const { db } = ports, { tools, names, toolsets } = catalog;
  for (const module of modules) {
    // One toolset per module name, like one MCP server per name.
    if (toolsets.has(module.name)) continue;
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const parsed = moduleManifestSchema.safeParse(version?.manifest);
    const visible = parsed.success ? parsed.data.tools.filter(tool => tool.visibility.includes(audience)) : [];
    if (!parsed.success || !visible.length) continue;
    toolsets.add(module.name);
    for (const tool of visible) {
      const name = `m_${module.name.replaceAll("-", "_")}_${tool.name.replaceAll("-", "_")}`;
      if (name.length > 64 || names.has(name)) continue;
      names.add(name);
      tools.push({ name, module, manifest: { ...parsed.data, tools: visible }, tool, direct: focus.includes(module.name) });
    }
  }
}
/** System tools visible to the audience (v2-13), then the workspace's active module tools it may call, ordered deterministically. */
export async function moduleTools(ports: StewardPorts, scope: Scope): Promise<Entry[]> {
  const { db } = ports, { workspaceId, sessionId, audience = "provider" } = scope;
  const session = sessionId ? await db.session.findFirst({ where: { id: sessionId, workspaceId } }) : null;
  const focus = Array.isArray(session?.focus) ? session.focus : [];
  const modules = await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const tools = systemEntries(audience), names = new Set(tools.map(tool => tool.name)), toolsets = new Set<string>();
  await addModuleTools(ports, modules, audience, focus, { tools, names, toolsets });
  return tools;
}
type Resolved = Awaited<ReturnType<typeof moduleTools>>[number];
function toolset({ module, manifest }: Resolved) {
  return { name: `module_${module.name.replaceAll("-", "_")}`, description: (manifest.description ?? manifest.tools.map(tool => tool.description).join("; ")).slice(0, 500) };
}
function catalogInput(tool: SystemTool | ModuleTool) {
  return "input" in tool && tool.input ? z.toJSONSchema(tool.input) : normalizedToolInputSchema(tool as ModuleTool);
}
function catalogOutput(tool: SystemTool | ModuleTool, system: boolean) {
  return tool.output ? (system ? z.toJSONSchema(tool.output as z.ZodType) : tool.output) : null;
}
function catalogEntry(resolved: Resolved) {
  const { tool } = resolved;
  return { name: resolved.name, exposure: resolved.direct ? "direct" as const : "deferred" as const, namespace: toolset(resolved),
    description: tool.description,
    inputSchema: { ...catalogInput(tool), additionalProperties: false, description: `[${resolved.system ? "Chrona" : "module"} ${resolved.module.name}] ${tool.description}` },
    outputSchema: catalogOutput(tool, !!resolved.system), examples: "examples" in tool ? tool.examples ?? null : null,
    sideEffects: "sideEffects" in tool ? tool.sideEffects ?? null : null, errors: "errors" in tool ? tool.errors ?? null : null,
    idempotent: tool.idempotent,
    retry: tool.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically." };
}
/** Focused tools are direct; all others are deferred and grouped per module. */
export async function moduleToolCatalog(ports: StewardPorts, scope: Scope) {
  return (await moduleTools(ports, scope)).map(catalogEntry);
}
type CatalogEntry = Awaited<ReturnType<typeof moduleToolCatalog>>[number];
/** Deferred tools grouped per module, like a list of MCP servers, so callers know what to search for. */
export function moduleToolsets(catalog: CatalogEntry[]) {
  const sets = new Map<string, CatalogEntry["namespace"] & { tools: string[] }>();
  for (const { name, exposure, namespace } of catalog) {
    if (exposure === "deferred") (sets.get(namespace.name) ?? sets.set(namespace.name, { ...namespace, tools: [] }).get(namespace.name)!).tools.push(name);
  }
  return [...sets.values()];
}
/** A routed call to a system tool (v2-13): the system module's own admission and validation apply, and the real caller is recorded. */
async function callSystemTool(ports: StewardPorts, caller: { workspaceId: string; runId: string | null; via?: string | null; deadline?: number }, resolved: Entry, raw: unknown) {
  const origin = { workspaceId: caller.workspaceId, caller: caller.runId ? { kind: "provider" as const, runId: caller.runId } : { kind: "owner" as const, via: caller.via ?? null }, chain: [], path: [], deadline: caller.deadline };
  try {
    const { output } = await callSync(ports, origin, `${resolved.module.name}.${resolved.tool.name}`, raw, caller.deadline ? { timeoutMs: Math.max(1000, caller.deadline - ports.now().getTime()) } : {});
    return { result: output };
  } catch (error) {
    // Restore system business refusals at the HTTP/tool boundary, not an opaque 500.
    if (error instanceof CallError && (error.code === "conflict" || error.code === "invalid" || error.code === "forbidden" || error.code === "not_found")) throw new StewardError(error.code, error.message);
    throw error;
  }
}
function eventCaller(caller: { runId: string | null; via?: string | null }) {
  return caller.runId ? { kind: "provider" as const, runId: caller.runId } : { kind: "owner" as const, via: caller.via ?? null };
}
async function recordToolMismatch(ports: StewardPorts, input: { caller: { workspaceId: string }; module: Resolved["module"]; tool: Resolved["tool"]; activationId: string | null; cause: unknown }): Promise<never> {
  const { caller, module, tool, activationId, cause } = input;
  const issues = (cause as { diagnosticIssues?: string[] }).diagnosticIssues;
  if (issues) await recordModuleOutputMismatch(ports.db, { workspaceId: caller.workspaceId, moduleId: module.id, activationId, hash: module.activeHash!, tool: tool.name, callId: randomUUID(), issues, now: ports.now() });
  throw new StewardError("conflict", (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000));
}
async function deliverModuleTool(ports: StewardPorts, caller: Omit<Scope, "audience"> & { runId: string | null; via?: string | null; deadline?: number }, name: string, resolved: Resolved, raw: unknown) {
  const args = validateToolArgs(resolved.tool as ModuleTool, raw), now = ports.now(), { module, tool } = resolved;
  const activationId = (await currentModuleEvolution(ports.db, caller.workspaceId, module.id, module.activeHash!))?.activationId ?? null;
  await audit(ports.db, { workspaceId: caller.workspaceId, actor: caller.runId ? "chrona" : "user", kind: "module_tool_call", subjectId: module.id, details: { tool: name, callerRunId: caller.runId, callerSessionId: caller.sessionId ?? null, via: caller.via ?? null } });
  try {
    const reply = await moduleSupervisor(ports).deliver(module.id, module.activeHash!, { trigger: { id: tool.name, kind: "tool", firedAt: now.toISOString(), args,
      caller: eventCaller(caller) }, now: now.toISOString(), params: {} }, { activationId, validateResult: output => moduleOutputError(`${module.name}.${tool.name}`, tool as ModuleTool, output) });
    if ("error" in reply) throw new Error(reply.error);
    checkModuleOutput(`${module.name}.${tool.name}`, tool as ModuleTool, reply.result.result ?? null);
    return { result: reply.result.result };
  } catch (cause) {
    return await recordToolMismatch(ports, { caller, module, tool, activationId, cause });
  }
}
/** Runs a workspace-owned module tool for a Provider run or the owner (`via`: the entry module that relayed an owner request). */
export async function callModuleTool(ports: StewardPorts, caller: Omit<Scope, "audience"> & { runId: string | null; via?: string | null; deadline?: number }, name: string, raw: unknown) {
  const audience = caller.runId ? "provider" as const : "owner" as const;
  const resolved = (await moduleTools(ports, { ...caller, audience })).find(tool => tool.name === name);
  if (!resolved) throw new StewardError("not_found", "Module tool not found");
  return resolved.system ? callSystemTool(ports, caller, resolved, raw) : deliverModuleTool(ports, caller, name, resolved, raw);
}
