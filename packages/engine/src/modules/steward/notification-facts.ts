import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { redactSensitiveText } from "@chrona/logging/redaction";
import type { StewardPorts } from "./ports";
import type { Caller } from "./module-calls";
import { CallError } from "./module-call-error";

type Db = StewardPorts["db"] | Prisma.TransactionClient;
const text = z.string().max(4000), links = { module: text.optional(), session: text.optional() };
export const lifecycleFactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["module-paused", "module-build-failed"]), app: text }),
  z.object({ kind: z.literal("module-activated"), app: text, update: z.boolean(), changes: z.array(text), preserves: z.array(text), hash: text }),
  z.object({ kind: z.literal("module-migration-failed"), app: text, restore: z.boolean() }),
  z.object({ kind: z.literal("schedule-failed"), target: text, status: text, error: text.nullable().optional(), disconnected: z.boolean().optional() }),
  z.object({ kind: z.literal("run-paused"), uncertain: z.boolean(), status: text, error: text.nullable().optional() }),
  z.object({ kind: z.literal("background-result"), title: text.nullable(), body: text }),
  z.object({ kind: z.literal("build-paused"), status: text, outcome: text }),
  z.object({ kind: z.literal("reflection-retired"), reflection: z.boolean(), mind: text, healthFixes: z.boolean().nullable() }),
]);
export type LifecycleFact = z.infer<typeof lifecycleFactSchema>;
export const noticeSchema = z.object({ key: text, title: z.string().max(200), body: text, level: z.enum(["now", "digest", "web"]), ...links,
  app: text.optional(), approval: text.optional(), scoped: z.boolean().optional(), urgent: z.boolean().optional(), responds: z.boolean().optional(), recipient: text.optional() }).strict();
export const kernelFactSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notice"), data: noticeSchema }),
  z.object({ type: z.literal("lifecycle"), data: z.object({ key: text, ...links, fact: lifecycleFactSchema }) }),
  z.object({ type: z.literal("withdraw"), data: z.object({ key: text }).strict() }),
  z.object({ type: z.literal("approval"), data: z.object({ approval: text, title: text, action: text, detail: text, preview: z.string().max(20000), module: text.optional() }).strict() }),
  z.object({ type: z.literal("configure"), data: z.object({ "daily-cap": z.number().int(), timezone: text, "digest-at": text, at: z.string().datetime(), "quiet-start": text.optional(), "quiet-end": text.optional() }).strict() }),
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
  return recordKernelFact(db, row.workspaceId, row.id, { type: "approval", data: { approval: row.id, title: row.title.slice(0, 4000), action: row.action, detail: row.detail.slice(0, 4000), preview: row.preview.slice(0, 20000), ...(row.moduleId ? { module: row.moduleId } : {}) } }, row.createdAt);
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
