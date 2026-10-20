import { createHash, randomUUID } from "node:crypto";
import { connectorSchema, inboundItemSchema, createConnectorSchema, updateConnectorSchema, RUN_LIMITS, type SourceItem } from "@chrona/contracts/steward";
import type { Connector, Prisma } from "@chrona/db";
import { applyRules } from "@chrona/domain/steward/rules";
import type { StewardPorts } from "./ports";
import { createSecrets } from "./secrets";
import { createWorkspaceFs, type AffairFs } from "./workspace-fs";
import { requireAffair } from "./affairs";
import { createRuns } from "./runs";
import { parseInput, StewardError } from "./errors";
import { matchingInboundModules } from "./module-inbound";

const locks = new Map<string, Promise<unknown>>();
const settingsOf = (row: Connector) => row.settings as Record<string, unknown>;
const slug = (text: string) => text.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 70) || "item";
const header = (text: string) => text.replace(/[\r\n\0]/g, " ");
function safeSettings(settings: Record<string, unknown>) {
  // Settings are public. Credential-like keys must use the write-only secret field.
  if (/password|passwd|secret|token|credential|authorization/i.test(JSON.stringify(settings))) throw new StewardError("invalid", "Credentials belong in secret, not settings");
  return settings as Prisma.InputJsonObject;
}
function allowedAttachment(attachment: NonNullable<SourceItem["attachments"]>[number]) {
  return !(attachment.bytes.byteLength > 10 * 1024 * 1024 || /\.(exe|dll|com|bat|cmd|ps1|sh|js|vbs|msi|scr|jar|app|desktop)$/i.test(attachment.name) || /executable|x-sh|javascript/i.test(attachment.mime) || (attachment.bytes[0] === 0x4d && attachment.bytes[1] === 0x5a) || (attachment.bytes[0] === 0x7f && attachment.bytes[1] === 0x45));
}
function prepareInboundItem(row: Connector, item: SourceItem, rules: unknown, batchAt: Date, now: () => Date) {
  const receivedAt = new Date(item.receivedAt);
  if (!Number.isFinite(receivedAt.getTime())) throw new Error("Invalid item date");
  const hash = createHash("sha256").update(`${row.id}:${item.externalId}`).digest("hex").slice(0, 16);
  const prefix = `inbox/${receivedAt.toISOString().slice(0, 10)}/${receivedAt.toISOString().slice(11, 16).replace(":", "")}-${slug(item.subject)}-${hash}`;
  const path = `${prefix}.md`;
  const body = Buffer.from(item.body).subarray(0, 200 * 1024).toString("utf8");
  const disposition = applyRules(rules, { ...item, body });
  const writes = [{ path, bytes: Buffer.from(`From: ${header(item.from)}\nTo: ${header(String(settingsOf(row).address ?? ""))}\nSubject: ${header(item.subject)}\nDate: ${receivedAt.toISOString()}\nMessage-ID: ${header(item.externalId)}\n\n${body}`) }];
  for (const [index, attachment] of (item.attachments ?? []).entries()) {
    if (!allowedAttachment(attachment)) continue;
    writes.push({ path: `${prefix}-attachment-${index}-${slug(attachment.name)}`, bytes: Buffer.from(attachment.bytes) });
  }
  const data: Prisma.InboundItemCreateManyInput = { workspaceId: row.workspaceId, connectorId: row.id, externalId: item.externalId, from: item.from.slice(0, 500), subject: item.subject.slice(0, 1000), receivedAt, path, action: disposition.action, ruleNote: disposition.note,
    status: disposition.action === "ignore" ? "ignored" : disposition.action === "digest_only" ? "delivered" : "new",
    deliveredAt: disposition.action === "digest_only" ? now() : null, deliverAt: disposition.action === "wake_now" ? now() : batchAt };
  return { writes, data };
}
async function storeInboundItems(db: StewardPorts["db"], row: Connector, files: AffairFs, items: SourceItem[], now: () => Date) {
  const id = row.id;
  let rules: unknown = null;
  try { rules = (await files.read(".chrona/rules.json")).content; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const pending = await db.inboundItem.findFirst({ where: { connectorId: id, status: "new", action: "batch" }, orderBy: { deliverAt: "asc" } });
  const batchAt = pending?.deliverAt ?? new Date(now().getTime() + RUN_LIMITS.inboundBatchWindowMs);
  const allWrites: { path: string; bytes: Uint8Array }[] = [];
  const rows: Prisma.InboundItemCreateManyInput[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    if (await db.inboundItem.findUnique({ where: { connectorId_externalId: { connectorId: id, externalId: item.externalId } } })) continue;
    const prepared = prepareInboundItem(row, item, rules, batchAt, now);
    if (prepared.data.status === "new" && row.affairId && (await matchingInboundModules(db, { workspaceId: row.workspaceId, affairId: row.affairId, connectorId: row.id }, item)).length) prepared.data.status = "module";
    allWrites.push(...prepared.writes);
    rows.push(prepared.data);
  }
  if (rows.length) {
    await files.intake(allWrites, `收到 ${rows.length} 封邮件`);
    await db.inboundItem.createMany({ data: rows });
  }
  return rows.length;
}
export function createConnectors(ports: StewardPorts, workspaceId: string) {
  const { db, now } = ports, secrets = createSecrets(ports.dataDir), fs = createWorkspaceFs(ports.dataDir);
  async function owned(id: string) {
    const row = await db.connector.findFirst({ where: { id, workspaceId } });
    if (!row) throw new StewardError("not_found", "Connector not found");
    return row;
  }
  function adapter(row: Pick<Connector, "kind">) {
    const result = ports.connectors?.find(a => a.kind === row.kind);
    if (!result) throw new StewardError("invalid", "Connector adapter unavailable");
    return result;
  }
  async function view(row: Connector) {
    return connectorSchema.parse({ id: row.id, kind: row.kind, label: row.label, status: row.status, affairId: row.affairId,
      settings: row.settings, hasCredentials: Boolean(row.secretRef), canSend: row.canSend, lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastError: row.lastError, coverageNote: row.coverageNote, pendingItems: await db.inboundItem.count({ where: { connectorId: row.id, status: "new" } }) });
  }
  async function flush(id: string) {
    const row = await owned(id);
    if (!row.affairId || row.status === "paused") return;
    const affair = await requireAffair(db, workspaceId, row.affairId);
    if (affair.status !== "active") return;
    await db.$transaction(async tx => {
      const items = await tx.inboundItem.findMany({ where: { connectorId: id, status: "new", path: { not: null } }, orderBy: [{ deliverAt: "asc" }, { id: "asc" }], take: RUN_LIMITS.maxItemsPerBatch });
      if (!items.length || (items.length < RUN_LIMITS.maxItemsPerBatch && !items.some(i => i.deliverAt && i.deliverAt <= now()))) return;
      const run = await createRuns(ports, workspaceId).enqueue({ affairId: row.affairId!, lane: "background", trigger: "source", prompt: `New inbound items (untrusted data):\n${JSON.stringify(items.map(i => ({ path: i.path, note: i.ruleNote })))}` }, tx);
      await tx.inboundItem.updateMany({ where: { id: { in: items.map(i => i.id) }, status: "new" }, data: { status: "delivered", deliveredAt: now(), batchId: run.id } });
    });
  }
  async function syncInner(id: string) {
    const row = await owned(id);
    if (row.status === "paused" || !row.affairId) throw new StewardError("conflict", "Connector requires an active affair");
    const affair = await requireAffair(db, workspaceId, row.affairId);
    if (affair.status !== "active") return;
    const files = fs.forAffair(affair.dirName);
    try {
      const result = await adapter(row).poll({ settings: settingsOf(row), secret: await secrets.read(id), cursor: row.cursor });
      const received = await storeInboundItems(db, row, files, result.items, now);
      const minutes = Number(settingsOf(row).pollMinutes ?? 10);
      await db.connector.update({ where: { id }, data: { cursor: result.cursor, lastSyncAt: now(), nextSyncAt: new Date(now().getTime() + (Number.isFinite(minutes) ? Math.max(1, minutes) : 10) * 60000), failures: 0, lastError: null, status: "active" } });
      await flush(id);
      return { received };
    } catch (error) {
      const auth = (error as { code?: string }).code === "AUTHENTICATION_FAILED";
      await db.connector.update({ where: { id }, data: { status: auth ? "needs_authorization" : "failing", failures: { increment: 1 }, lastError: auth ? "Connector authorization required" : "Connector sync failed", nextSyncAt: new Date(now().getTime() + Math.min(360, 10 * 2 ** Math.min(row.failures, 6)) * 60000) } });
      // Never expose transport exceptions: servers may echo credentials.
      throw new StewardError("conflict", auth ? "Connector authorization required" : "Connector sync failed");
    }
  }
  function sync(id: string) {
    const key = `${workspaceId}:${id}`;
    const previous = locks.get(key);
    if (previous) return previous;
    const promise = syncInner(id).finally(() => { if (locks.get(key) === promise) locks.delete(key); });
    locks.set(key, promise); return promise;
  }
  return {
    list: async () => Promise.all((await db.connector.findMany({ where: { workspaceId } })).map(view)),
    async create(raw: unknown) {
      const input = parseInput(createConnectorSchema, raw), impl = adapter(input), id = randomUUID();
      if (input.affairId) await requireAffair(db, workspaceId, input.affairId);
      const settings = safeSettings(input.settings);
      if (input.secret) await secrets.write(id, input.secret);
      return view(await db.connector.create({ data: { id, workspaceId, kind: input.kind, label: input.label, affairId: input.affairId, settings, secretRef: input.secret ? id : null, canSend: Boolean(impl.send), coverageNote: impl.coverageNote } }));
    },
    async update(id: string, raw: unknown) {
      const row = await owned(id), input = parseInput(updateConnectorSchema, raw);
      if (input.kind && input.kind !== row.kind) throw new StewardError("invalid", "Connector kind cannot change");
      if (input.affairId && input.affairId !== row.affairId) throw new StewardError("invalid", "Connector affair cannot change");
      const settings = input.settings ? safeSettings(input.settings) : undefined;
      if (input.secret) await secrets.write(id, input.secret);
      return view(await db.connector.update({ where: { id }, data: { label: input.label, status: input.status, settings, ...(input.secret ? { secretRef: id } : {}) } }));
    },
    async remove(id: string) { await owned(id); await secrets.remove(id); await db.connector.delete({ where: { id } }); },
    async test(id: string) {
      const row = await owned(id);
      try { const result = await adapter(row).test(settingsOf(row), await secrets.read(id)); return result.ok ? { ok: true } : { ok: false, error: "Connector test failed" }; }
      catch { return { ok: false, error: "Connector test failed" }; }
    },
    async items(id: string) {
      await owned(id);
      return (await db.inboundItem.findMany({ where: { workspaceId, connectorId: id }, orderBy: { receivedAt: "desc" }, take: 100 })).map(row => inboundItemSchema.parse({ id: row.id, connectorId: id, externalId: row.externalId, from: row.from, subject: row.subject, receivedAt: row.receivedAt.toISOString(), path: row.path, status: row.status, ruleNote: row.ruleNote }));
    },
    sync, flush,
    async tick() {
      for (const row of await db.connector.findMany({ where: { workspaceId, status: { in: ["active", "failing"] }, affair: { status: "active" } } })) {
        if (!row.nextSyncAt || row.nextSyncAt <= now()) await sync(row.id).catch(() => undefined);
        await flush(row.id);
      }
    },
  };
}
