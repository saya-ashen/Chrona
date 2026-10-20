import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, moduleOutputSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import type { InboundItem } from "@chrona/db";
import { inboundMatches } from "@chrona/domain/steward/inbound-match";
import type { StewardPorts } from "./ports";
import { createWorkspaceFs } from "./workspace-fs";
import { recordModuleResult, type ModuleResult } from "./module-effects";

export async function matchingInboundModules(db: StewardPorts["db"], scope: { workspaceId: string; affairId: string; connectorId: string }, item: { from: string; subject: string }, statuses = ["active"]) {
  const { workspaceId, affairId, connectorId } = scope;
  const modules = await db.module.findMany({ where: { workspaceId, affairId, status: { in: statuses }, activeHash: { not: null } }, orderBy: { name: "asc" } });
  const matches = [];
  for (const module of modules) {
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const parsed = moduleManifestSchema.safeParse(version?.manifest);
    if (!parsed.success) continue;
    const manifest = parsed.data;
    for (const trigger of manifest.triggers) {
      if ("inbound" in trigger && trigger.inbound.connector === connectorId && inboundMatches(trigger.inbound.match, item)) matches.push({ module, manifest, trigger });
    }
  }
  return matches;
}
type Match = Awaited<ReturnType<typeof matchingInboundModules>>[number];
async function runInbound(ports: StewardPorts, match: Match, item: InboundItem, body: string, now: Date): Promise<ModuleResult> {
  const { module, manifest, trigger } = match;
  let exitCode = -1;
  try {
    const dataDir = join(ports.dataDir, "platform/data", module.id);
    await mkdir(dataDir, { recursive: true });
    if (!ports.sandbox?.available || !ports.sandbox.runModule) throw new Error("Module sandbox unavailable");
    const receivedAt = item.receivedAt.toISOString();
    const result = await ports.sandbox.runModule({
      codeDir: join(ports.dataDir, "platform/store", module.activeHash!), dataDir, entry: manifest.entry,
      input: { trigger: { id: trigger.id, kind: "inbound", firedAt: receivedAt, item: { externalId: item.externalId, from: item.from, subject: item.subject, receivedAt, body } }, now: now.toISOString(), params: Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value])) },
      network: manifest.effects.includes("network"), timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes,
    });
    exitCode = result.exitCode ?? -1;
    if (result.status !== "succeeded" || exitCode !== 0) throw new Error(`Module ${result.status}; exit ${exitCode}: ${result.error ?? ""}`);
    return { manifest, output: moduleOutputSchema.parse(JSON.parse(result.output)), exitCode, error: null };
  } catch (cause) {
    return { manifest, output: null, exitCode, error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000) };
  }
}
async function inboundBody(ports: StewardPorts, dirName: string, path: string | null) {
  if (!path) throw new Error("Inbound item file missing");
  const { content } = await createWorkspaceFs(ports.dataDir).forAffair(dirName).read(path);
  const boundary = /\r?\n\r?\n/.exec(content);
  const body = boundary ? content.slice(boundary.index + boundary[0].length) : "";
  return new TextDecoder().decode(Buffer.from(body).subarray(0, 64 * 1024), { stream: true });
}
async function processItem(ports: StewardPorts, item: InboundItem, token: string, now: Date) {
  const { db } = ports;
  const connector = await db.connector.findUnique({ where: { id: item.connectorId }, include: { affair: true } });
  const finish = (data: { status: string; action?: string; deliveredAt?: Date; ruleNote?: string }) => db.inboundItem.updateMany({ where: { id: item.id, status: "module", leaseToken: token }, data: { ...data, leaseToken: null, leaseUntil: null } });
  // receivedAt, not createdAt, anchors the 30-minute fallback (including old mail at intake).
  if (now.getTime() - item.receivedAt.getTime() > 30 * 60000 || connector?.affair?.status !== "active") return finish({ status: "new" });
  const affair = connector.affair;
  const matches = await matchingInboundModules(db, { workspaceId: item.workspaceId, affairId: affair.id, connectorId: connector.id }, item, ["active", "migrating"]);
  if (matches.some(match => match.module.status === "migrating")) return finish({ status: "module" });
  const handled = await executeMatches(ports, { item, token, now, affair }, matches);
  return finish(handled ? { status: "delivered", action: "module", deliveredAt: now, ruleNote: `模块 ${handled} 已处理` } : { status: "new" });
}
async function runItem(ports: StewardPorts, match: Match, item: InboundItem, dirName: string, now: Date): Promise<ModuleResult> {
  try { return await runInbound(ports, match, item, await inboundBody(ports, dirName, item.path), now); }
  catch (cause) { return { manifest: match.manifest, output: null, error: String(cause).slice(0, 2000), exitCode: -1 }; }
}
async function executeMatches(ports: StewardPorts, scope: { item: InboundItem; token: string; now: Date; affair: { id: string; dirName: string } }, matches: Match[]) {
  const { item, token, now, affair } = scope, { db } = ports;
  let handled: string | undefined;
  const context = { now, chatBound: ports.chat ? await ports.chat.bound() : false, publicUrl: ports.publicUrl };
  for (const match of matches) {
    const current = await db.module.findUnique({ where: { id: match.module.id } });
    if (current?.status !== "active" || current.activeHash !== match.module.activeHash) continue;
    const renewed = await db.inboundItem.updateMany({ where: { id: item.id, status: "module", leaseToken: token }, data: { leaseUntil: new Date(ports.now().getTime() + RUN_LIMITS.jobTimeoutMs + 60000) } });
    if (!renewed.count) break;
    const result = await runItem(ports, match, item, affair.dirName, now);
    const recorded = await db.$transaction(async tx => {
      const owned = await tx.inboundItem.updateMany({ where: { id: item.id, status: "module", leaseToken: token }, data: { leaseUntil: new Date(ports.now().getTime() + RUN_LIMITS.jobTimeoutMs + 60000) } });
      if (!owned.count) return false;
      await recordModuleResult(tx, ports, { workspaceId: item.workspaceId, affairId: affair.id, moduleId: match.module.id, hash: match.module.activeHash!, triggerId: match.trigger.id, firedAt: item.receivedAt, inboundItemId: item.id }, result, context);
      return true;
    });
    if (recorded && !result.error && result.output?.handled) handled ??= match.module.name;
  }
  return handled;
}
export async function processModuleInbound(ports: StewardPorts, workspaceId: string, now = ports.now()) {
  const available = { workspaceId, status: "module", OR: [{ leaseToken: null }, { leaseUntil: null }, { leaseUntil: { lte: now } }] };
  const items = await ports.db.inboundItem.findMany({ where: available, orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: 10 });
  for (const item of items) {
    const token = randomUUID();
    const claimed = await ports.db.inboundItem.updateMany({ where: { ...available, id: item.id }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + RUN_LIMITS.jobTimeoutMs + 60000) } });
    if (claimed.count) await processItem(ports, item, token, now);
  }
}
