import { moduleToolContract } from "./module-tool-contract";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { listSystemModules, type Caller, type SystemTool, type Tool } from "./module-calls";
import { discoveryAdmission } from "./module-call-admission";
import { StewardError } from "../errors";
import { isModulePaused } from "./module-availability";

type Reference = { target: string; source: { kind: "system" | "module"; hash: string | null }; tool: SystemTool | Tool };
/** Batch only current approved versions, without loading historical manifests or runtime evidence. */
export async function activeModuleReferences(ports: StewardPorts, workspaceId: string) {
  const modules = (await ports.db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, activeHash: true } })).filter(module => !isModulePaused(module.name));
  if (!modules.length) return [];
  const versions = [];
  for (let offset = 0; offset < modules.length; offset += 200) {
    versions.push(...await ports.db.moduleVersion.findMany({ where: { status: "approved", OR: modules.slice(offset, offset + 200).map(module => ({ moduleId: module.id, hash: module.activeHash! })) }, select: { moduleId: true, hash: true, manifest: true } }));
  }
  const byModule = new Map(versions.map(version => [version.moduleId, version]));
  return modules.flatMap(module => {
    const version = byModule.get(module.id), manifest = moduleManifestSchema.safeParse(version?.manifest).data;
    if (!manifest || version?.hash !== module.activeHash) return [];
    return manifest.tools.map(tool => ({ target: `${module.name}.${tool.name}`, source: { kind: "module" as const, hash: module.activeHash! }, moduleId: module.id, tool }));
  });
}
export async function references(ports: StewardPorts, workspaceId: string): Promise<Reference[]> {
  return [...listSystemModules().flatMap(module => module.tools.map(tool => ({ target: `${module.name}.${tool.name}`, source: { kind: "system" as const, hash: null }, tool }))), ...await activeModuleReferences(ports, workspaceId)];
}

async function exactReference(ports: StewardPorts, workspaceId: string, target: string): Promise<Reference | undefined> {
  const separator = target.indexOf("."), name = target.slice(0, separator), toolName = target.slice(separator + 1);
  if (separator < 1) return;
  const system = listSystemModules().find(module => module.name === name);
  if (system) {
    const tool = system.tools.find(tool => tool.name === toolName);
    return tool ? { target, source: { kind: "system", hash: null }, tool } : undefined;
  }
  if (isModulePaused(name)) return;
  const module = await ports.db.module.findFirst({ where: { workspaceId, name, status: "active", activeHash: { not: null } }, select: { id: true, activeHash: true } });
  if (!module?.activeHash) return;
  const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } }, select: { status: true, manifest: true } });
  if (version?.status !== "approved") return;
  const tool = moduleManifestSchema.safeParse(version.manifest).data?.tools.find(tool => tool.name === toolName);
  return tool ? { target, source: { kind: "module", hash: module.activeHash }, tool } : undefined;
}

function retryDescription(idempotent: boolean) {
  return idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.";
}
function referenceContract(target: string, { tool, source }: Reference) {
  return { target, source, description: tool.description, inputSchema: moduleToolContract(tool).input, outputSchema: moduleToolContract(tool).output,
    documentation: "documentation" in tool ? tool.documentation ?? null : null, examples: "examples" in tool ? tool.examples ?? null : null,
    sideEffects: "sideEffects" in tool ? tool.sideEffects ?? null : null, errors: "errors" in tool ? tool.errors ?? null : null,
    retry: retryDescription(tool.idempotent), admission: { visibility: tool.visibility, uses: target, idempotent: tool.idempotent },
    routingErrors: ["forbidden", "not_found", "conflict", "cycle", "invalid", "unknown", "failed", "unavailable"] };
}
/** Code metadata only: never call a handler, inspect settings, read incidents or start a module. */
export async function interfaceReference(ports: StewardPorts, workspaceId: string, target?: string, caller?: Caller) {
  const canRead = caller ? await discoveryAdmission(ports.db, caller, workspaceId) : () => true;
  if (target) {
    const entry = await exactReference(ports, workspaceId, target);
    if (!entry || !canRead(entry.tool)) throw new StewardError("not_found", "Interface reference not found");
    return referenceContract(target, entry);
  }
  // The index names interfaces; contracts come one target at a time (all of them overflowed the Provider's tool result).
  return (await references(ports, workspaceId)).filter(entry => canRead(entry.tool)).map(({ target, source, tool }) => ({ target, source, description: tool.description }));
}
