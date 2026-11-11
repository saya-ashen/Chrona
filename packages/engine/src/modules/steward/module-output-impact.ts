import { moduleManifestSchema, type ModuleTool, type ModuleToolParameter } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

// Mirror normalizedToolInputSchema/moduleCallbackContractHash for persisted manifest tools.
// Importing module-calls here would cycle through supervisor -> builtin -> build -> impact.
function normalizedParameter(parameter: ModuleToolParameter): Record<string, unknown> {
  if ("anyOf" in parameter) return { anyOf: parameter.anyOf.map(normalizedParameter), ...(parameter.description ? { description: parameter.description } : {}) };
  if (parameter.type === "array") return { type: "array", ...(parameter.description ? { description: parameter.description } : {}), items: normalizedParameter(parameter.items) };
  if (parameter.type === "object") return { type: "object", ...(parameter.description ? { description: parameter.description } : {}), properties: Object.fromEntries(Object.entries(parameter.properties).map(([key, value]) => [key, normalizedParameter(value)])), required: parameter.required ?? [], additionalProperties: parameter.additionalProperties };
  return { ...parameter };
}
function contract(tool: ModuleTool): string {
  const input = { type: "object", properties: Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, value]) => [key, normalizedParameter(value)])), required: tool.parameters.required, additionalProperties: false };
  return JSON.stringify({ input, output: tool.output, visibility: [...tool.visibility].sort(), idempotent: tool.idempotent }, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
}
function approvedManifest(version: { status: string; manifest: unknown } | null, name: string) {
  if (version?.status !== "approved") return undefined;
  const manifest = moduleManifestSchema.safeParse(version.manifest).data;
  return manifest?.name === name ? manifest : undefined;
}
type Db = StewardPorts["db"];
export type OutputImpact = { caller: string; targets: string[] };

/** Active approved callers admitted by an existing changed/removed contract's audience. */
export async function moduleOutputImpacts(db: Db, workspaceId: string, moduleId: string, nextManifest: ReturnType<typeof moduleManifestSchema.parse>): Promise<OutputImpact[]> {
  const module = await db.module.findUnique({ where: { id: moduleId } });
  if (module?.workspaceId !== workspaceId || !module.activeHash) return [];
  const activeVersion = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } });
  const previous = approvedManifest(activeVersion, module.name);
  if (!previous) return [];
  const nextTools = new Map(nextManifest.tools.map(tool => [tool.name, tool]));
  const changed = previous.tools.filter(old => {
    const next = nextTools.get(old.name);
    return (old.visibility.includes("modules") || old.visibility.includes("owner")) && (!next || contract(old) !== contract(next));
  });
  // New tools have no existing consumers to invalidate.
  if (!changed.length) return [];
  const consumers = await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null }, id: { not: moduleId } }, orderBy: { name: "asc" } });
  const impacts: OutputImpact[] = [];
  for (const caller of consumers) {
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.id, hash: caller.activeHash! } } });
    const manifest = approvedManifest(version, caller.name);
    if (!manifest) continue;
    const targets = changed.filter(tool => tool.visibility.includes("modules") || manifest.authority === "owner").map(tool => `${module.name}.${tool.name}`);
    if (targets.length) impacts.push({ caller: caller.name, targets });
  }
  return impacts;
}

export const outputImpactSummary = (impacts: OutputImpact[]) => impacts.map(({ caller, targets }) => `${caller}：${targets.join("、")}`);
