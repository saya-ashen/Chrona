import { moduleToolContract } from "./modules/module-tool-contract";
import { z } from "zod";
import { moduleManifestSchema, moduleCapabilitiesSchema, moduleOriginSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { moduleCapabilities, moduleIdentity } from "./modules/module-identity";
import { CallError, listSystemModules, type SystemTool, type Tool } from "./modules/module-calls";

const interfaceToolSchema = z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.json()), outputSchema: z.json().nullable(),
  examples: z.array(z.json()).nullable(), sideEffects: z.array(z.string()).nullable(), errors: z.array(z.object({ code: z.string(), description: z.string(), recovery: z.string() })).nullable(),
  idempotent: z.boolean(), retry: z.string(), visibility: z.array(z.string()) });
const interfaceSchema = z.object({ origin: moduleOriginSchema, capabilities: moduleCapabilitiesSchema, name: z.string(), description: z.string(), sessions: z.string().nullable(), tools: z.array(interfaceToolSchema) });
export const moduleInterfacesOutputSchema = z.union([z.array(interfaceSchema), interfaceSchema]);
function toolMetadata(tool: SystemTool | Tool) {
  return { name: tool.name, description: tool.description, inputSchema: moduleToolContract(tool).input,
    outputSchema: moduleToolContract(tool).output, examples: "examples" in tool ? tool.examples ?? null : null,
    sideEffects: "sideEffects" in tool ? tool.sideEffects ?? null : null, errors: "errors" in tool ? tool.errors ?? null : null,
    idempotent: tool.idempotent, retry: tool.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.", visibility: tool.visibility };
}
/** Internal declaration inspection for kernel registrations and installed apps. Not a public directory. */
export async function moduleInterfaces(ports: StewardPorts, workspaceId: string, name?: string) {
  const entries = listSystemModules().map(module => ({ origin: "kernel" as const,
    capabilities: moduleCapabilities("kernel"), name: module.name, description: module.description, sessions: module.sessions ?? null,
    tools: module.tools.map(tool => toolMetadata(tool)) }));
  if (name === undefined) return entries;
  const entry = entries.find(item => item.name === name);
  if (entry) return entry;
  const module = await ports.db.module.findFirst({ where: { workspaceId, OR: [{ id: name }, { name }] }, select: { id: true, name: true, builtin: true, activeHash: true } });
  if (!module) throw new CallError("not_found", `Module ${name} not found`);
  const version = module.activeHash ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } }, select: { manifest: true } }) : null;
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
  return { name: module.name, ...moduleIdentity(module), description: manifest?.description ?? "", sessions: null, tools: (manifest?.tools ?? []).map(tool => toolMetadata(tool)) };
}
