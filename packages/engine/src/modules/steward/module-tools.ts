import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { moduleManifestSchema, moduleOutputSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { recordModuleResult, type ModuleResult } from "./module-effects";

type Scope = { workspaceId: string; affairId: string | null };
type Manifest = z.infer<typeof moduleManifestSchema>;
type Tool = Manifest["tools"][number];
export async function moduleTools(ports: StewardPorts, scope: Scope) {
  if (!scope.affairId) return [];
  const { db } = ports, { workspaceId, affairId } = scope;
  const modules = await db.module.findMany({ where: { workspaceId, affairId, status: "active", activeHash: { not: null } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const tools = [], names = new Set<string>();
  for (const module of modules) {
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const parsed = moduleManifestSchema.safeParse(version?.manifest);
    if (!parsed.success) continue;
    for (const tool of parsed.data.tools) {
      const name = `m_${module.name.replaceAll("-", "_")}_${tool.name.replaceAll("-", "_")}`;
      if (name.length > 64 || names.has(name)) continue;
      names.add(name);
      tools.push({ name, module, manifest: parsed.data, tool });
    }
  }
  return tools;
}
export async function moduleToolCatalog(ports: StewardPorts, scope: Scope) {
  return (await moduleTools(ports, scope)).map(({ name, module, tool }) => ({ name, inputSchema: { ...tool.parameters, additionalProperties: false, description: `[module ${module.name}] ${tool.description}` } }));
}
function validateArgs(tool: Tool, raw: unknown) {
  const shape = Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, property]) => {
    let schema: z.ZodType = "enum" in property ? z.enum(property.enum) : z[property.type]();
    if (!tool.parameters.required.includes(key)) schema = schema.optional();
    return [key, schema];
  }));
  return parseInput(z.object(shape).strict(), raw);
}
type Resolved = Awaited<ReturnType<typeof moduleTools>>[number];
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
export async function callModuleTool(ports: StewardPorts, scope: Scope, name: string, raw: unknown) {
  const resolved = (await moduleTools(ports, scope)).find(tool => tool.name === name);
  if (!resolved) throw new StewardError("not_found", "Module tool not found");
  const args = validateArgs(resolved.tool, raw), now = ports.now();
  const result = await runTool(ports, resolved, args, now);
  const context = { now, chatBound: ports.chat ? await ports.chat.bound() : false, publicUrl: ports.publicUrl };
  const effects = await ports.db.$transaction(tx => recordModuleResult(tx, ports, { workspaceId: scope.workspaceId, affairId: scope.affairId!, moduleId: resolved.module.id, hash: resolved.module.activeHash!, triggerId: `tool:${resolved.tool.name}`, firedAt: now }, result, context));
  if (result.error) throw new StewardError("conflict", result.error);
  return { result: result.output?.result, effects };
}
