import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { agentProviderRegisterInput as agentRegisterSchema, moduleManifestSchema, runtimeHealthSchema } from "@chrona/contracts/steward";
import type { Caller } from "../modules/module-call-types";
import type { StewardPorts } from "../ports";
import { CallError } from "../modules/module-call-error";
import { moduleCallbackContractHash } from "../modules/module-tool-contract";
import { callSync, kernelOrigin } from "../modules/module-calls";

export const providerCompletionBudgetSchema = z.object({ reservationId: z.string(), maxOutputTokens: z.number().int().positive(), limits: z.object({ eventTimeoutMs: z.number().int().positive(), maxOutputTokens: z.number().int().positive() }).passthrough() });
export type ProviderDeclaration = z.infer<typeof agentRegisterSchema>;
export type ProviderSnapshot = ProviderDeclaration & { contracts: Record<string, string> };
export type ProviderBinding = { providerId: string; moduleId: string; hash: string; revision: string; declaration: unknown };
export const providerDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
export function providerSnapshot(value: unknown): ProviderSnapshot {
  const declaration = agentRegisterSchema.parse(value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contracts")) : value);
  const { contracts } = z.object({ contracts: z.record(z.string(), z.string()) }).parse(value);
  return { ...declaration, contracts };
}
async function declaredProvider(tx: Prisma.TransactionClient, workspaceId: string, { moduleId, hash }: Pick<ProviderBinding, "moduleId" | "hash">, declaration: ProviderDeclaration, allowFenced = false) {
  const module = await tx.module.findFirst({ where: { id: moduleId, workspaceId, activeHash: hash, status: "active", ...(allowFenced ? {} : { executionFenceAt: null }) } });
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (!module || version?.status !== "approved") throw new CallError("forbidden", "Provider registration requires its approved active module");

  const manifest = moduleManifestSchema.parse(version.manifest), contracts: Record<string, string> = {};
  if (!declaration.capabilities.conversation && !declaration.capabilities.completion) throw new CallError("invalid", "Provider must offer conversation or completion");
  for (const capability of ["native", "completion"] as const) {
    if (declaration.capabilities[capability] && !declaration.endpoints[capability === "completion" ? "complete" : "native"]) throw new CallError("invalid", `Provider ${capability} endpoint is required`);
  }
  for (const endpoint of Object.values(declaration.endpoints)) {
    if (!endpoint) continue;
    const tool = manifest.tools.find(tool => tool.name === endpoint);
    if (!tool || tool.visibility.length !== 1 || tool.visibility[0] !== "kernel") throw new CallError("forbidden", "Provider backend endpoints must be own kernel-visible tools");
    contracts[endpoint] = moduleCallbackContractHash(tool);
  }
  if (declaration.configuration) {
    const tool = manifest.tools.find(tool => tool.name === declaration.configuration!.tool);
    if (!tool || !tool.visibility.includes("owner")) throw new CallError("invalid", "Provider configuration requires an owner-visible tool");
    contracts[tool.name] = moduleCallbackContractHash(tool);
  }
  return { ...declaration, contracts } satisfies ProviderSnapshot;
}
export async function assertProviderBinding(tx: Prisma.TransactionClient, workspaceId: string, binding: ProviderBinding) {
  return checkProviderBinding(tx, workspaceId, binding);
}
async function checkProviderBinding(tx: Prisma.TransactionClient, workspaceId: string, binding: ProviderBinding, allowFenced = false) {
  const snapshot = providerSnapshot(binding.declaration);
  const current = await declaredProvider(tx, workspaceId, binding, snapshot, allowFenced);
  if (providerDigest(current) !== providerDigest(snapshot) || providerDigest([binding.moduleId, binding.hash, snapshot]) !== binding.revision) throw new CallError("conflict", "Admitted provider identity or endpoint contract changed");
  return snapshot;
}
export async function registerAgentProvider(ports: StewardPorts, workspaceId: string, caller: Caller, raw: unknown) {
  if (caller.kind !== "module") throw new CallError("forbidden", "Only an approved active module can register a provider");
  const declaration = agentRegisterSchema.parse(raw);
  const row = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const snapshot = await declaredProvider(tx, workspaceId, caller, declaration);
    const prior = await tx.agentProvider.findUnique({ where: { workspaceId_id: { workspaceId, id: declaration.id } } });
    if (prior && prior.moduleId !== caller.moduleId) throw new CallError("conflict", "Provider id is registered by another module");
    const data = { moduleId: caller.moduleId, hash: caller.hash, revision: providerDigest([caller.moduleId, caller.hash, snapshot]), declaration: snapshot as Prisma.InputJsonValue, updatedAt: ports.now() };
    return tx.agentProvider.upsert({ where: { workspaceId_id: { workspaceId, id: declaration.id } }, create: { workspaceId, id: declaration.id, ...data, createdAt: ports.now() }, update: data });
  });
  // Registration may run inside the provider's activated handler. A health call back
  // into that same serialized module would wait for this registration to finish.
  return providerView(ports, workspaceId, { ...row, providerId: row.id }, false);
}
const lastAvailabilityError = new Map<string, string | null>();
/** Health is polled often; log only transitions so the reason is visible without flooding the journal. */
function logAvailabilityChange(key: string, provider: string, error: string | null) {
  if (lastAvailabilityError.get(key) === error) return;
  lastAvailabilityError.set(key, error);
  console.error(JSON.stringify({ component: "agent-provider", event: error === null ? "provider_available" : "provider_unavailable", provider, ...(error === null ? {} : { error }) }));
}
type ProviderHealth = z.infer<typeof runtimeHealthSchema>;
const pendingHealth = new WeakMap<StewardPorts["db"], Map<string, Promise<ProviderHealth>>>();
async function providerHealth(ports: StewardPorts, workspaceId: string, binding: ProviderBinding) {
  let pending = pendingHealth.get(ports.db);
  if (!pending) { pending = new Map(); pendingHealth.set(ports.db, pending); }
  const key = JSON.stringify([workspaceId, binding.providerId, binding.moduleId, binding.hash, binding.revision]);
  const existing = pending.get(key);
  if (existing) {
    // Sharing an ongoing probe must not let a newly paused or replaced provider remain eligible.
    await checkProviderBinding(ports.db, workspaceId, binding);
    return existing;
  }
  const probe = callProviderEndpoint(ports, workspaceId, binding, "health", {}).then(value => runtimeHealthSchema.parse(value))
    .finally(() => { pending.delete(key); });
  pending.set(key, probe);
  return probe;
}
export async function providerView(ports: StewardPorts, workspaceId: string, binding: ProviderBinding, observeHealth = true) {
  const snapshot = providerSnapshot(binding.declaration);
  let available = false, error: string | null = null;
  try {
    if (!observeHealth) throw new CallError("unavailable", "Provider health has not been observed");
    const health = await providerHealth(ports, workspaceId, binding);
    available = health.available; error = health.available ? null : health.error ?? "unavailable without a reason";
  } catch (failure) {
    // An installed registration remains discoverable while its module is unavailable.
    if (observeHealth) error = String((failure as Error)?.message ?? failure).slice(0, 300);
  }
  logAvailabilityChange(`${workspaceId}:${binding.moduleId}`, snapshot.id, error);
  const { contracts: _contracts, ...declaration } = snapshot;
  return { ...declaration, moduleId: binding.moduleId, hash: binding.hash, revision: binding.revision, available };
}
export async function listAgentProviders(ports: StewardPorts, workspaceId: string, args: { id?: string; cursor?: string; limit?: number }) {
  const limit = args.limit ?? 50;
  const rows = await ports.db.agentProvider.findMany({ where: { workspaceId, ...((args.id || args.cursor) ? { id: { ...(args.id ? { equals: args.id } : {}), ...(args.cursor ? { gt: args.cursor } : {}) } } : {}) }, orderBy: { id: "asc" }, take: limit + 1 });
  const page = rows.slice(0, limit);
  return { items: await Promise.all(page.map(row => providerView(ports, workspaceId, { ...row, providerId: row.id }))), nextCursor: rows.length > limit ? page.at(-1)!.id : null };
}
export async function selectAgentProvider(ports: StewardPorts, workspaceId: string, providerId?: string) {
  const rows = await ports.db.agentProvider.findMany({ where: { workspaceId, ...(providerId ? { id: providerId } : {}) }, orderBy: { id: "asc" } });
  const candidates = [];
  for (const row of rows) {
    const binding = { ...row, providerId: row.id };
    if ((await providerView(ports, workspaceId, binding)).available) candidates.push(binding);
  }
  if (!candidates.length) throw new CallError("unavailable", "No available registered provider");
  if (candidates.length !== 1) throw new CallError("conflict", "Select a providerId when multiple providers are available");
  return candidates[0]!;
}
/** A drain fence closes admission, but must leave the original operation observable and stoppable. */
async function boundProviderControl(tx: Prisma.TransactionClient, workspaceId: string, binding: ProviderBinding, endpoint: keyof ProviderDeclaration["endpoints"], args: Record<string, unknown>) {
  if (!["status", "abort", "release"].includes(endpoint) || typeof args.operationId !== "string" || Object.keys(args).length !== 1) return false;
  const admitted = await tx.agentRunProvider.findFirst({ where: { runId: args.operationId, providerId: binding.providerId, moduleId: binding.moduleId, hash: binding.hash, revision: binding.revision, run: { workspaceId, providerLaunch: { isNot: null } } } });
  return admitted !== null && providerDigest(admitted.declaration) === providerDigest(binding.declaration);
}
export async function callProviderEndpoint<T>(ports: StewardPorts, workspaceId: string, binding: ProviderBinding, endpoint: keyof ProviderDeclaration["endpoints"], args: Record<string, unknown>, key?: string): Promise<T> {
  const allowFenced = await boundProviderControl(ports.db, workspaceId, binding, endpoint, args);
  const snapshot = await checkProviderBinding(ports.db, workspaceId, binding, allowFenced), tool = snapshot.endpoints[endpoint];
  if (!tool) throw new CallError("unavailable", `Provider ${endpoint} is unsupported`);
  return (await callSync(ports, kernelOrigin(workspaceId), { moduleId: binding.moduleId, tool }, args, { key, private: true, expectedHash: binding.hash, expectedTarget: { moduleId: binding.moduleId } })).output as T;
}
export async function runProviderBinding(ports: StewardPorts, workspaceId: string, runId: string) {
  const binding = await ports.db.agentRunProvider.findFirst({ where: { runId, run: { workspaceId } } });
  if (!binding) throw new CallError("unavailable", "Run has no admitted provider binding");
  return binding;
}

/** Internal queue admissions choose once, without making external calls inside the writer transaction. */
export async function bindQueuedProviderIn(tx: Prisma.TransactionClient, workspaceId: string, runId: string, providerId?: string, providerOptions: Prisma.InputJsonObject = {}) {
  const rows = await tx.agentProvider.findMany({ where: { workspaceId, ...(providerId ? { id: providerId } : {}) }, orderBy: { id: "asc" } });
  if (!rows.length) { if (providerId) throw new CallError("unavailable", "Selected registered provider is unavailable"); return; }
  const candidates = [];
  for (const row of rows) {
    const binding = { ...row, providerId: row.id };
    try {
      const declaration = await assertProviderBinding(tx, workspaceId, binding);
      if (declaration.capabilities.conversation) candidates.push(binding);
    } catch (error) { if (!(error instanceof CallError)) throw error; }
  }
  if (candidates.length !== 1) throw new CallError(candidates.length ? "conflict" : "unavailable", "Internal Run requires one approved registered conversation provider");
  const binding = candidates[0]!;
  await tx.agentRunProvider.create({ data: { runId, providerId: binding.providerId, moduleId: binding.moduleId, hash: binding.hash, revision: binding.revision, declaration: binding.declaration as Prisma.InputJsonValue, providerOptions, kind: "conversation" } });
  await tx.run.update({ where: { id: runId }, data: { provider: binding.providerId } });
}
