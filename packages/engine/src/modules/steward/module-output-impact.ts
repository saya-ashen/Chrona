import { grantedUses, moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
};
type Db = StewardPorts["db"];
export type OutputImpact = { caller: string; targets: string[] };

/** Current active callers whose declared uses point at a changed/removed target contract. */
export async function moduleOutputImpacts(db: Db, workspaceId: string, moduleId: string, nextManifest: ReturnType<typeof moduleManifestSchema.parse>): Promise<OutputImpact[]> {
  const module = await db.module.findUnique({ where: { id: moduleId } });
  if (!module?.activeHash) return [];
  const activeVersion = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } });
  const previous = moduleManifestSchema.safeParse(activeVersion?.manifest).data;
  if (!previous) return [];
  const oldTools = new Map(previous.tools.map(tool => [tool.name, tool]));
  const nextTools = new Map(nextManifest.tools.map(tool => [tool.name, tool]));
  const changed = new Map<string, { exact: boolean; wildcard: boolean }>();
  for (const [name, oldTool] of oldTools) {
    const next = nextTools.get(name);
    if ((!next || canonical(oldTool.output ?? null) !== canonical(next.output ?? null))
      && (oldTool.visibility.includes("modules") || oldTool.visibility.includes("owner") || next?.visibility.includes("modules") || next?.visibility.includes("owner")))
      changed.set(`${module.name}.${name}`, { exact: oldTool.visibility.includes("modules") || !!next?.visibility.includes("modules"), wildcard: oldTool.visibility.includes("owner") || !!next?.visibility.includes("owner") });
  }
  for (const [name, next] of nextTools) if (!oldTools.has(name) && (next.visibility.includes("modules") || next.visibility.includes("owner")))
    changed.set(`${module.name}.${name}`, { exact: next.visibility.includes("modules"), wildcard: next.visibility.includes("owner") });
  if (!changed.size) return [];
  const callers = await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null }, id: { not: moduleId } }, orderBy: { name: "asc" } });
  const impacts: OutputImpact[] = [];
  for (const caller of callers) {
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.id, hash: caller.activeHash! } } });
    const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
    if (!manifest) continue;
    const uses = grantedUses(manifest);
    const targets = [...changed].filter(([target, details]) => details.exact && uses.includes(target) || details.wildcard && uses.includes("*")).map(([target]) => target);
    if (targets.length) impacts.push({ caller: caller.name, targets });
  }
  return impacts;
}

export const outputImpactSummary = (impacts: OutputImpact[]) => impacts.map(({ caller, targets }) => `${caller}：${targets.join("、")}`);
