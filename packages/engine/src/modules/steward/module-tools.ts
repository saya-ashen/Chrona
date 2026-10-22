import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { moduleManifestSchema, moduleOutputSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { recordModuleResult, type ModuleResult } from "./module-effects";
import { audit } from "./audit";

/** The caller's affair only orders and labels; module tools run in their own module's affair. */
type Scope = { workspaceId: string; affairId: string | null };
type Manifest = z.infer<typeof moduleManifestSchema>;
type Tool = Manifest["tools"][number];
/** Active module tools of the workspace; the caller's affair first, so its modules win name conflicts. */
export async function moduleTools(ports: StewardPorts, scope: Scope) {
  const { db } = ports, { workspaceId, affairId } = scope;
  const modules = (await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, include: { affair: { select: { title: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] }))
    .sort((a, b) => Number(b.affairId === affairId) - Number(a.affairId === affairId));
  const tools = [], names = new Set<string>(), toolsets = new Set<string>();
  for (const module of modules) {
    // One toolset per module name, like one MCP server per name.
    if (toolsets.has(module.name)) continue;
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const parsed = moduleManifestSchema.safeParse(version?.manifest);
    if (!parsed.success || !parsed.data.tools.length) continue;
    toolsets.add(module.name);
    for (const tool of parsed.data.tools) {
      const name = `m_${module.name.replaceAll("-", "_")}_${tool.name.replaceAll("-", "_")}`;
      if (name.length > 64 || names.has(name)) continue;
      names.add(name);
      tools.push({ name, module, manifest: parsed.data, tool, direct: module.affairId === affairId });
    }
  }
  return tools;
}
type Resolved = Awaited<ReturnType<typeof moduleTools>>[number];
function toolset({ module, manifest }: Resolved) {
  return { name: `module_${module.name.replaceAll("-", "_")}`, description: `${manifest.description ?? manifest.tools.map(tool => tool.description).join("; ")} (affair: ${module.affair.title})`.slice(0, 500) };
}
/** Tools of the caller's affair are declared up front; the rest are deferred behind the Provider's tool search, grouped per module. */
export async function moduleToolCatalog(ports: StewardPorts, scope: Scope) {
  return (await moduleTools(ports, scope)).map(resolved => ({ name: resolved.name, exposure: resolved.direct ? "direct" as const : "deferred" as const, namespace: toolset(resolved),
    inputSchema: { ...resolved.tool.parameters, additionalProperties: false, description: `[module ${resolved.module.name}] ${resolved.tool.description}` } }));
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
export function moduleToolShape(tool: Tool) {
  return Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, property]) => {
    let schema: z.ZodType = "enum" in property ? z.enum(property.enum) : z[property.type]();
    if (property.description) schema = schema.describe(property.description);
    if (!tool.parameters.required.includes(key)) schema = schema.optional();
    return [key, schema];
  }));
}
function validateArgs(tool: Tool, raw: unknown) {
  return parseInput(z.object(moduleToolShape(tool)).strict(), raw);
}
async function runTool(ports: StewardPorts, resolved: Resolved, args: unknown, now: Date): Promise<ModuleResult> {
  const { module, manifest, tool } = resolved;
  let exitCode = -1;
  try {
    const dataDir = join(ports.dataDir, "platform/data", module.id);
    await mkdir(dataDir, { recursive: true });
    if (!ports.sandbox?.available || !ports.sandbox.runModule) throw new Error("Module sandbox unavailable");
    const result = await ports.sandbox.runModule({
      codeDir: join(ports.dataDir, "platform/store", module.activeHash!), dataDir, entry: manifest.entry,
      input: { trigger: { id: tool.name, kind: "tool", firedAt: now.toISOString(), args }, now: now.toISOString(), params: Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value])) },
      network: manifest.effects.includes("network"), timeoutMs: Math.min(RUN_LIMITS.jobTimeoutMs, 50_000), maxOutputBytes: RUN_LIMITS.jobOutputBytes,
    });
    exitCode = result.exitCode ?? -1;
    if (result.status !== "succeeded" || exitCode !== 0) throw new Error(result.error || `Module ${result.status}; exit ${exitCode}`);
    return { manifest, output: moduleOutputSchema.parse(JSON.parse(result.output)), exitCode, error: null };
  } catch (cause) {
    return { manifest, output: null, exitCode, error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000) };
  }
}
/** Runs a module tool for a caller (a run, or the owner when runId is null) under the module's own affair. */
export async function callModuleTool(ports: StewardPorts, caller: Scope & { runId: string | null }, name: string, raw: unknown) {
  const resolved = (await moduleTools(ports, caller)).find(tool => tool.name === name);
  if (!resolved) throw new StewardError("not_found", "Module tool not found");
  const args = validateArgs(resolved.tool, raw), now = ports.now(), { module } = resolved;
  const result = await runTool(ports, resolved, args, now);
  const context = { now, chatBound: ports.chat ? await ports.chat.bound() : false, publicUrl: ports.publicUrl };
  const effects = await ports.db.$transaction(async tx => {
    await audit(tx, { workspaceId: caller.workspaceId, actor: caller.runId ? "chrona" : "user", kind: "module_tool_call", subjectId: module.id, details: { tool: name, callerRunId: caller.runId, callerAffairId: caller.affairId } });
    return recordModuleResult(tx, ports, { workspaceId: caller.workspaceId, affairId: module.affairId, moduleId: module.id, hash: module.activeHash!, triggerId: `tool:${resolved.tool.name}`, firedAt: now }, result, context);
  });
  if (result.error) throw new StewardError("conflict", result.error);
  return { result: result.output?.result, effects };
}
