import { moduleHealthSummarySchema } from "../module-diagnostics";
import { apiPage, pagePosition } from "../api-page";
import { moduleOperation } from "../module-operation";
import { routedTargetName } from "../module-calls";
import type { RoutedTarget } from "@chrona/contracts/steward";
import { moduleToolContract } from "../module-tool-contract";
import { publicSystemTools } from "./tool-contract-declarations";
import { createModules } from "../modules";
import { discoveryAdmission } from "../module-call-admission";
import { CallError } from "../module-call-error";
import { listSystemModules } from "../module-registry";
import { normalizedToolInputSchema } from "../module-tool-contract";
import type { Caller, Json, Tool } from "../module-call-types";
import type { SystemModule } from "../module-system-types";
import type { SystemTool } from "../module-system-tool-types";
import { admitCandidates, candidateSource, submitCandidates, checkCandidates } from "../module-candidates";
import { activeModuleReferences, interfaceReference } from "../module-reference";
import type { StewardPorts } from "../ports";
import { json, requireOwner } from "./shared";

type ToolSearchOptions = { workspaceId: string; canRead: (tool: SystemTool | Tool) => boolean; words: string[]; userTools: boolean };
const searchMatch = ({ canRead, words, userTools }: ToolSearchOptions, target: string, candidate: SystemTool | Tool) => (!userTools || candidate.visibility.some(audience => audience === "owner" || audience === "provider")) && words.every(word => `${target} ${candidate.description}`.toLowerCase().includes(word)) && canRead(candidate);
type ToolSearchResult = { moduleId?: string; hash?: string; target: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Json | null; examples: Json[] | null; sideEffects: string[] | null; errors: Json[] | null; retry: string; idempotent: boolean };
function searchSystemResult(target: string, candidate: SystemTool): ToolSearchResult { return { target, description: candidate.description, inputSchema: moduleToolContract(candidate).input, outputSchema: moduleToolContract(candidate).output as Json | null, examples: (candidate as { examples?: Json[] }).examples ?? null, sideEffects: "sideEffects" in candidate ? (candidate as { sideEffects?: string[] }).sideEffects ?? null : null, errors: "errors" in candidate ? (candidate as { errors?: Json[] }).errors ?? null : null, retry: candidate.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.", idempotent: candidate.idempotent }; }
function searchModuleResult(target: string, candidate: Tool): ToolSearchResult { return { target, description: candidate.description, inputSchema: normalizedToolInputSchema(candidate), outputSchema: candidate.output, examples: candidate.examples ? candidate.examples as unknown as Json[] : null, sideEffects: candidate.sideEffects ?? null, errors: candidate.errors ? candidate.errors as unknown as Json[] : null, retry: candidate.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.", idempotent: candidate.idempotent }; }
async function searchActiveModuleTools(ports: StewardPorts, options: ToolSearchOptions, found: ToolSearchResult[]) {
  for (const { target, tool, moduleId, source } of await activeModuleReferences(ports, options.workspaceId)) {
    if (searchMatch(options, target, tool)) found.push({ ...searchModuleResult(target, tool), moduleId, hash: source.hash });
  }
}
async function toolSearch(ports: StewardPorts, workspaceId: string, caller: Caller, query: unknown, userTools = false) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean), found: ToolSearchResult[] = [];
  const options = { workspaceId, canRead: await discoveryAdmission(ports.db, caller, workspaceId), words, userTools };
  for (const system of listSystemModules()) for (const candidate of system.tools) {
    const target = `${system.name}.${candidate.name}`;
    if (searchMatch(options, target, candidate)) found.push(searchSystemResult(target, candidate));
  }
  await searchActiveModuleTools(ports, options, found);
  return found;
}
async function describe(ports: StewardPorts, workspaceId: string, caller: Caller, args: Record<string, unknown>) {
      if (args.target) {
        const target = await routedTargetName(ports.db, workspaceId, args.target as RoutedTarget);
        const detail = await interfaceReference(ports, workspaceId, target, caller);
        return json({ ...detail, label: target, target: args.target });
      }
      const found = await toolSearch(ports, workspaceId, caller, args.query, args.audience === "user");
      const items = found.map(item => ({ ...item, label: item.target, target: item.moduleId ? { moduleId: item.moduleId, tool: item.target.slice(item.target.indexOf(".") + 1) } : item.target }));
      return json(apiPage(items, { cursor: args.cursor, limit: args.limit }, `describe:${workspaceId}:${JSON.stringify(caller)}:${args.query ?? ""}:${args.audience}`, row => typeof row.target === "string" ? row.target : `${row.target.moduleId}.${row.target.tool}`));
}
async function health(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
  const api = createModules(ports, workspaceId);
      const input = { cursor: args.cursor, limit: args.limit }, scope = `health:${workspaceId}:${args.moduleId ?? ""}:${!!args.detail}`;
      const position = pagePosition(input, scope);
      const ids = await ports.db.module.findMany({ where: { workspaceId, ...(args.moduleId ? { id: String(args.moduleId) } : {}), ...(position.after ? { id: { gt: position.after } } : {}) }, orderBy: { id: "asc" }, take: position.limit + 1, select: { id: true } });
      if (args.moduleId && !position.after && !ids.length) throw new CallError("not_found", "Application not found");
      const rows = (await Promise.all(ids.map(row => api.diagnostics(row.id)))).flat();
      return json(apiPage(args.detail ? rows : rows.map(row => moduleHealthSummarySchema.parse(row)), input, scope, row => row.moduleId));
}
async function writeCandidates({ ports, workspaceId, caller, call }: Parameters<SystemModule["handle"]>[0], name: "admit" | "submit", args: Record<string, unknown>) {
  if (!call?.key) throw new CallError("invalid", "Material writes require a call key");
  const input = { ...args, requestKey: call.key };
  // The sync invocation owns publication for this key, including competing direct calls.
  return json(name === "admit" ? await admitCandidates(ports, workspaceId, caller, input) : await submitCandidates(ports, workspaceId, caller, input, { invocationId: call.mode === "sync" ? call.id : undefined }));
}
/** Fixed materials and governed lifecycle; authoring, distribution and application preferences belong to applications. */
export const modules: SystemModule = {
  name: "modules",
  description: "Installed identity, reachable contracts, fixed candidate receipts and governed lifecycle.",
  tools: publicSystemTools.modules,
  // Pure reads omit keyless invocation receipts; keys retain deduplication.
  unrecorded: ["list", "describe", "health", "receipt"],
  async handle(context, name, args) {
    const { ports, workspaceId, caller, call } = context;
    const api = createModules(ports, workspaceId);
    if (name === "list") {
      const input = { cursor: args.cursor, limit: args.limit }, scope = `modules:${workspaceId}`;
      return json(apiPage(await api.list(pagePosition(input, scope)), input, scope, row => row.id));
    }
    if (name === "describe") return describe(ports, workspaceId, caller, args);
    if (name === "health") return health(ports, workspaceId, args);
    if (name === "admit" || name === "submit") return writeCandidates(context, name, args);
    if (name === "source") return json(await candidateSource(ports, workspaceId, caller, args));
    if (name === "receipt") return json(await checkCandidates(ports, workspaceId, caller, args.receiptId ? { receiptId: args.receiptId } : { admissionId: args.admissionId, requestKey: args.requestKey ?? args.key }));
    if (["operation", "rollback", "disable", "enable", "remove"].includes(name)) {
      await requireOwner(ports.db, workspaceId, caller);
      return json(await moduleOperation({ ports, workspaceId, caller, call }, name, args));
    }
    throw new CallError("not_found", `modules.${name} not found`);
  },
};
