import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ACTIONS } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import { redactSensitiveText } from "@chrona/logging/redaction";
import type { StewardPorts } from "./ports";
import type { Caller } from "./module-call-types";
import { CallError } from "./module-call-error";

type Db = StewardPorts["db"] | Prisma.TransactionClient;
const text = z.string().max(4000), identity = z.string().min(1).max(256);
const links = { module: identity.optional(), session: identity.optional() };
/** Closed runtime vocabulary: application content and notification policy belong to the consumer. */
export const lifecycleFactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["module-paused", "module-build-failed"]), app: identity }).strict(),
  z.object({ kind: z.literal("module-activated"), app: identity, update: z.boolean(), hash: identity }).strict(),
  z.object({ kind: z.literal("module-migration-failed"), app: identity, restore: z.boolean() }).strict(),
  z.object({ kind: z.literal("schedule-failed"), target: identity, status: z.enum(["failed", "unknown"]), error: text.nullable().optional(), disconnected: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("build-paused"), status: z.enum(["failed", "timed_out", "provider_unavailable"]) }).strict(),
]);
export type LifecycleFact = z.infer<typeof lifecycleFactSchema>;
// The question and response protocol remain in provider interactions; this is only its runtime identity.
export const noticeSchema = z.object({ key: identity, kind: z.literal("provider-input-required"), run: identity, session: identity.optional() }).strict();
export const kernelFactSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notice"), data: noticeSchema }).strict(),
  z.object({ type: z.literal("lifecycle"), data: z.object({ key: identity, ...links, fact: lifecycleFactSchema }).strict() }).strict(),
  z.object({ type: z.literal("withdraw"), data: z.object({ key: identity }).strict() }).strict(),
  z.object({ type: z.literal("approval"), data: z.object({ approval: identity, title: text, action: z.enum(ACTIONS), detail: text, preview: z.string().max(20000), module: identity.optional() }).strict() }).strict(),
]);
export type KernelFact = z.infer<typeof kernelFactSchema>;
const consumerSchema = z.object({ moduleId: z.string().nullable(), revision: z.string() }).strict();
const consumerId = (workspaceId: string) => `kernel-fact-consumer:${workspaceId}`;
const pending = "kernel_fact_pending", consumed = "kernel_fact_consumed";
function safeData(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    const limit = key === "preview" ? 20000 : key === "title" ? 200 : 4000;
    return typeof item === "string" ? redactSensitiveText(item, limit).slice(0, limit) : item;
  }));
}
const factId = (workspaceId: string, type: string, key: string) => `kernel-fact:${createHash("sha256").update(JSON.stringify([workspaceId, type, key])).digest("hex")}`;
/** Facts commit with state; duplicate writes never reset consumption. No module target or delivery queue. */
export function recordKernelFact(db: Db, workspaceId: string, key: string, fact: KernelFact, at: Date) {
  const details = kernelFactSchema.parse(safeData(fact));
  const id = factId(workspaceId, fact.type, details.type === "withdraw" ? details.data.key : key);
  return db.audit.upsert({ where: { id }, create: { id, workspaceId, kind: pending, actorKey: "kernel", details, createdAt: at }, update: {} });
}
export function recordApprovalFact(db: Db, row: { workspaceId: string; id: string; title: string; action: string; detail: string; preview: string; moduleId: string | null; createdAt: Date }) {
  return recordKernelFact(db, row.workspaceId, row.id, { type: "approval", data: { approval: row.id, title: row.title.slice(0, 4000), action: z.enum(ACTIONS).parse(row.action), detail: row.detail.slice(0, 4000), preview: row.preview.slice(0, 20000), ...(row.moduleId ? { module: row.moduleId } : {}) } }, row.createdAt);
}
export function recordWithdrawal(db: Db, workspaceId: string, key: string, at: Date) {
  return recordKernelFact(db, workspaceId, key, { type: "withdraw", data: { key } }, at);
}
export async function factConsumer(db: Db, workspaceId: string) {
  const row = await db.audit.findUnique({ where: { id: consumerId(workspaceId) } });
  return row ? consumerSchema.parse(row.details) : { moduleId: null, revision: "unselected" };
}
/** Release installer alone chooses the initial app. An explicit null selection is never overwritten. */
export function seedFactConsumer(db: Db, workspaceId: string, moduleId: string, at: Date) {
  return db.audit.upsert({ where: { id: consumerId(workspaceId) }, create: { id: consumerId(workspaceId), workspaceId, kind: "kernel_fact_consumer", actorKey: "release", details: { moduleId, revision: randomUUID() }, createdAt: at }, update: {} });
}
export async function selectFactConsumer(db: StewardPorts["db"], workspaceId: string, moduleId: string | null, at: Date) {
  return db.$transaction(async tx => {
    const current = await factConsumer(tx, workspaceId);
    if (current.moduleId === moduleId && current.revision !== "unselected") return current;
    if (current.moduleId && (await tx.module.findFirst({ where: { workspaceId, id: current.moduleId } }))?.status === "active") throw new CallError("conflict", "Pause the previous fact consumer before switching");
    if (moduleId && !await tx.module.findFirst({ where: { workspaceId, id: moduleId, status: "active", activeHash: { not: null } } })) throw new CallError("not_found", "Active consumer module not found");
    const next = { moduleId, revision: randomUUID() };
    await tx.audit.upsert({ where: { id: consumerId(workspaceId) }, create: { id: consumerId(workspaceId), workspaceId, kind: "kernel_fact_consumer", actorKey: "owner", details: next, createdAt: at }, update: { details: next, actorKey: "owner" } });
    return next;
  });
}
async function selectedCaller(db: Db, workspaceId: string, caller: Caller, revision?: string) {
  const selected = await factConsumer(db, workspaceId);
  if (caller.kind !== "module" || caller.moduleId !== selected.moduleId) throw new CallError("forbidden", "Only the selected application consumes kernel facts");
  if (revision !== undefined && selected.revision !== revision) throw new CallError("conflict", "Fact consumer changed");
  const active = await db.module.findFirst({ where: { workspaceId, id: caller.moduleId, activeHash: caller.hash, status: "active" } });
  if (!active) throw new CallError("forbidden", "Fact consumer identity is no longer active");
  return { ...selected, moduleId: caller.moduleId };
}
export async function readKernelFacts(db: StewardPorts["db"], workspaceId: string, caller: Caller) {
  return db.$transaction(async tx => {
    const selected = await selectedCaller(tx, workspaceId, caller);
    const rows = await tx.audit.findMany({ where: { workspaceId, kind: pending }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50 });
    return { revision: selected.revision, facts: rows.map(row => ({ id: row.id, at: row.createdAt.toISOString(), ...kernelFactSchema.parse(row.details) })) };
  });
}
/** Withdrawals remain authoritative after consumption, including across consumer switches. */
export async function withdrawnKernelKeys(db: StewardPorts["db"], workspaceId: string, caller: Caller, revision: string, keys: string[]) {
  return db.$transaction(async tx => {
    await selectedCaller(tx, workspaceId, caller, revision);
    const identities = new Map(keys.map(key => [factId(workspaceId, "withdraw", key), key]));
    const rows = await tx.audit.findMany({ where: { workspaceId, id: { in: [...identities.keys()] }, kind: { in: [pending, consumed] } }, select: { id: true } });
    return { withdrawn: rows.map(row => identities.get(row.id)!) };
  });
}
export async function acknowledgeKernelFacts(db: StewardPorts["db"], workspaceId: string, caller: Caller, revision: string, ids: string[]) {
  return db.$transaction(async tx => {
    const selected = await selectedCaller(tx, workspaceId, caller, revision), actorKey = `consumer:${selected.moduleId}`;
    await tx.audit.updateMany({ where: { workspaceId, kind: pending, id: { in: ids } }, data: { kind: consumed, actorKey } });
    const accepted = await tx.audit.findMany({ where: { workspaceId, kind: consumed, actorKey, id: { in: ids } }, select: { id: true } });
    return { acknowledged: accepted.map(row => row.id) };
  });
}
