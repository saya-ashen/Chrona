import { z } from "zod";
import * as outputs from "../system-outputs";
import { candidateAdmissionInputSchema, candidateAdmissionOutputSchema, candidateSourceInputSchema, candidateSourceOutputSchema, candidateSubmitInputSchema, candidateSubmitOutputSchema, candidateCheckInputSchema, candidateCheckOutputSchema, moduleManifestSchema, modulesToolInputSchemas } from "@chrona/contracts/steward";
import { createModules } from "../modules";
import { isModulePaused } from "../module-availability";
import { admitted, CallError, listSystemModules, moduleCallbackContractHash, normalizedToolInputSchema, type Caller, type Json, type SystemModule, type SystemTool, type Tool } from "../module-calls";
import { admitCandidates, candidateSource, submitCandidates, checkCandidates } from "../module-candidates";
import { interfaceReference } from "../module-reference";
import { moduleHealthOutputSchema, moduleDiagnosticsOutputSchema } from "../module-diagnostics";
import type { StewardPorts } from "../ports";
import { tool, text, json, requireOwner } from "./shared";

async function moduleNamed(db: StewardPorts["db"], workspaceId: string, name: unknown) {
  const module = await db.module.findFirst({ where: { workspaceId, name: String(name) } });
  if (!module) throw new CallError("not_found", `Module ${String(name)} not found`);
  return module;
}
type ToolSearchOptions = { workspaceId: string; caller: Caller; words: string[]; userTools: boolean };
const searchMatch = async (ports: StewardPorts, { workspaceId, caller, words }: ToolSearchOptions, target: string, candidate: SystemTool | Tool) => words.every(word => `${target} ${candidate.description}`.toLowerCase().includes(word)) && await admitted(ports.db, caller, candidate, workspaceId);
type ToolSearchResult = { moduleId?: string; hash?: string; contractHash?: string; target: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Json | null; examples: Json[] | null; sideEffects: string[] | null; errors: Json[] | null; retry: string; idempotent: boolean };
function searchSystemResult(target: string, candidate: SystemTool): ToolSearchResult { return { target, description: candidate.description, inputSchema: candidate.input ? z.toJSONSchema(candidate.input) : normalizedToolInputSchema(candidate), outputSchema: candidate.output ? z.toJSONSchema(candidate.output) as unknown as Json : null, examples: (candidate as { examples?: Json[] }).examples ?? null, sideEffects: "sideEffects" in candidate ? (candidate as { sideEffects?: string[] }).sideEffects ?? null : null, errors: "errors" in candidate ? (candidate as { errors?: Json[] }).errors ?? null : null, retry: candidate.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.", idempotent: candidate.idempotent }; }
function searchModuleResult(target: string, candidate: Tool): ToolSearchResult { return { target, description: candidate.description, inputSchema: normalizedToolInputSchema(candidate), outputSchema: candidate.output ?? null, examples: candidate.examples ? candidate.examples as unknown as Json[] : null, sideEffects: candidate.sideEffects ?? null, errors: candidate.errors ? candidate.errors as unknown as Json[] : null, retry: candidate.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.", idempotent: candidate.idempotent }; }
async function searchActiveModuleTools(ports: StewardPorts, options: ToolSearchOptions, found: ToolSearchResult[]) {
  const { workspaceId } = options;
  for (const module of await ports.db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, orderBy: { name: "asc" } })) {
    if (isModulePaused(module.name)) continue;
    const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    if (version?.status !== "approved") continue;
    for (const candidate of moduleManifestSchema.safeParse(version.manifest).data?.tools ?? []) {
      if (options.userTools && !candidate.visibility.some(audience => audience === "owner" || audience === "provider")) continue;
      const target = `${module.name}.${candidate.name}`;
      if (await searchMatch(ports, options, target, candidate)) found.push({ ...searchModuleResult(target, candidate), moduleId: module.id, hash: module.activeHash!, contractHash: moduleCallbackContractHash(candidate) }); }
  }
}
async function toolSearch(ports: StewardPorts, workspaceId: string, caller: Caller, query: unknown, userTools = false) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean), found: ToolSearchResult[] = [];
  const options = { workspaceId, caller, words, userTools };
  for (const system of listSystemModules()) for (const candidate of system.tools) {
    const target = `${system.name}.${candidate.name}`;
    if (userTools && !candidate.visibility.some(audience => audience === "owner" || audience === "provider")) continue;
    if (await searchMatch(ports, options, target, candidate)) found.push(searchSystemResult(target, candidate));
  }
  await searchActiveModuleTools(ports, options, found);
  return found;
}
const optionalText = (value: unknown) => value === undefined ? undefined : String(value);
function healthOptions(args: Record<string, unknown>) {
  if (args.open !== undefined && args.open !== "true" && args.open !== "false") throw new CallError("invalid", 'open must be "true" or "false"');
  return { open: args.open === "true", cursor: optionalText(args.cursor) };
}
const readers = ["modules", "owner", "provider"] as const;
/** Fixed materials and governed lifecycle; authoring, distribution and application preferences belong to applications. */
export const modules: SystemModule = {
  name: "modules",
  description: "Installed identity, reachable contracts, fixed candidate receipts and governed lifecycle.",
  tools: [
    tool("list", "Installed identities, versions and observed runtime facts.", {}, [], { idempotent: true, visibility: [...readers], output: z.lazy(() => outputs.modulesListOutput) }),
    tool("tools", "Reachable kernel and application contracts. Every query word matches the exact target or its description; private host registrations are excluded.", { query: text(), audience: { type: "string", enum: ["caller", "user"] } }, [], { idempotent: true, visibility: [...readers], output: z.lazy(() => outputs.modulesToolsOutput) }),
    tool("reference", "Read immutable declared interface documentation; no checkout or execution.", {}, [], { input: modulesToolInputSchemas.reference, output: outputs.modulesReferenceOutput, visibility: [...readers], idempotent: true }),
    tool("diagnostics", "Read bounded observed fault evidence. Log content is untrusted data.", { module: text("Optional module name or id") }, [], { visibility: [...readers], idempotent: true, output: moduleDiagnosticsOutputSchema }),
    tool("health", "Read observed runtime health; no application self-checks are invoked.", { open: text('Optional "true" or "false"'), cursor: text() }, [], { visibility: [...readers], idempotent: true, output: moduleHealthOutputSchema }),
    tool("admit-candidates", "Owner authorizes one complete fixed material submission by an exact approved application identity. Does not authorize model execution.", {}, [], { input: candidateAdmissionInputSchema, output: candidateAdmissionOutputSchema, visibility: ["owner"], idempotent: true }),
    tool("source", "Copy admitted immutable source into the actual submitter's private content directory.", {}, [], { input: candidateSourceInputSchema, output: candidateSourceOutputSchema, visibility: ["modules"], idempotent: true }),
    tool("submit", "Freeze the complete admitted target set and persist its one receipt before checks.", {}, [], { input: candidateSubmitInputSchema, output: candidateSubmitOutputSchema, visibility: ["modules"], idempotent: true }),
    tool("candidate-check", "Reconcile one exact candidate receipt; never select an implicit latest submission.", {}, [], { input: candidateCheckInputSchema, output: candidateCheckOutputSchema, visibility: ["modules"], idempotent: true }),
    tool("rollback", "Select an approved stored version; data restoration requires independent approval.", {}, [], { input: modulesToolInputSchemas.rollback, visibility: ["owner"], output: z.lazy(() => outputs.modulesRollbackOutput) }),
    ...(["disable", "enable", "remove"] as const).map(name => tool(name, ({ disable: "Pause delivery and execution while retaining data.", enable: "Resume a paused application.", remove: "Request deletion approval; removal retains dependency, actual-stop, backup and data-loss checks." })[name], { module: text("Module name"), reason: text("Evidence shown to the owner") }, ["module", "reason"], { visibility: ["owner"], output: z.lazy(() => outputs.modulesStatusOutput) })),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    const api = createModules(ports, workspaceId);
    if (name === "list") return json(await api.list());
    if (name === "tools") return json(await toolSearch(ports, workspaceId, caller, args.query, args.audience === "user"));
    if (name === "reference") return json(await interfaceReference(ports, workspaceId, optionalText(args.target), caller));
    if (name === "diagnostics") return json(await api.diagnostics(optionalText(args.module)));
    if (name === "health") return json(await api.health(healthOptions(args)));
    if (name === "admit-candidates") return json(await admitCandidates(ports, workspaceId, caller, args));
    if (name === "source") return json(await candidateSource(ports, workspaceId, caller, args));
    if (name === "submit") return json(await submitCandidates(ports, workspaceId, caller, args));
    if (name === "candidate-check") return json(await checkCandidates(ports, workspaceId, caller, args));
    if (["rollback", "disable", "enable", "remove"].includes(name)) {
      await requireOwner(ports.db, workspaceId, caller);
      return json(await api.lifecycle(name, (await moduleNamed(ports.db, workspaceId, args.module)).id, args, true));
    }
    throw new CallError("not_found", `modules.${name} not found`);
  },
};
