import { z } from "zod";
import { AgentUnavailableError, DISPOSITIONS, createConnectionSchema, connectionTransitionSchema, type ConnectionKind } from "@chrona/contracts/steward";
import type { StewardPorts } from "./service";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toConnection, toInboundEvent } from "./store";
import { queueAffair } from "./affairs";
import { enqueueNotification } from "./notify";
const proposalSchema = z.object({ disposition: z.enum(DISPOSITIONS), affairId: z.string().min(1).nullable(), whatHappened: z.string().max(4000), whyItMatters: z.string().max(2000), important: z.boolean() }).strict();
const backoff = (attempt: number) => Math.min(21600000, 60000 * 2 ** Math.min(attempt, 9));
export function createConnections(ports: StewardPorts, workspaceId: string) {
  const { db } = ports;
  async function requireConnection(id: string) {
    const row = await db.sourceConnection.findFirst({ where: { workspaceId, id } });
    if (!row) throw new StewardError("not_found", "Connection not found");
    return row;
  }
  async function syncConnection(id: string, now = ports.now()) {
    const connection = await requireConnection(id);
    if (connection.status === "paused" || connection.status === "revoked") return;
    const token = crypto.randomUUID();
    if (!(await db.sourceConnection.updateMany({ where: { id, workspaceId, revision: connection.revision, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 300000) } })).count) return;
    const adapter = ports.sources.find(s => s.kind === connection.kind);
    try {
      const ready = adapter ? await adapter.readiness(connection) : { state: "unsupported", reason: "Source adapter unavailable" } as const;
      if (ready.state !== "ready") {
        await db.$transaction(async tx => {
          if ((await tx.sourceConnection.updateMany({ where: { id, leaseToken: token, revision: connection.revision }, data: { status: "needs_authorization", lastError: ready.reason.slice(0, 500), leaseToken: null, leaseUntil: null } })).count) await audit(tx, { workspaceId, kind: "connection_readiness", actor: "chrona", subjectId: id, details: { state: ready.state } });
        });
        return;
      }
      const result = await adapter!.poll(connection, connection.cursor);
      await db.$transaction(async tx => {
        if (!(await tx.sourceConnection.updateMany({ where: { id, leaseToken: token, revision: connection.revision }, data: { status: "active", cursor: result.nextCursor, baselineAt: connection.baselineAt ?? now, lastSuccessAt: now, lastError: null, nextCheckAt: new Date(now.getTime() + (connection.pollIntervalSeconds ?? 300) * 1000), leaseToken: null, leaseUntil: null } })).count) return;
        for (const item of result.items) {
          const occurredAt = new Date(item.occurredAt);
          if (!item.externalId || !Number.isFinite(occurredAt.getTime())) throw new Error("Invalid source item");
          await tx.inboundEvent.upsert({ where: { connectionId_externalId: { connectionId: id, externalId: item.externalId } }, update: {}, create: { workspaceId, connectionId: id, externalId: item.externalId, title: item.title.slice(0, 500), body: item.body.slice(0, 8000), url: item.url, occurredAt, receivedAt: now, status: !connection.baselineAt && !item.current ? "baseline" : "pending" } });
        }
        await audit(tx, { workspaceId, kind: "connection_synced", actor: "chrona", subjectId: id, details: { items: result.items.length, baseline: !connection.baselineAt } });
      });
    } catch {
      await db.$transaction(async tx => {
        if ((await tx.sourceConnection.updateMany({ where: { id, leaseToken: token, revision: connection.revision }, data: { status: "failing", lastFailureAt: now, lastError: "Source sync failed", nextCheckAt: new Date(now.getTime() + 60000), leaseToken: null, leaseUntil: null } })).count) await audit(tx, { workspaceId, kind: "connection_sync_failed", actor: "chrona", subjectId: id, details: {} });
      });
    }
  }
  async function assessPending(now = ports.now()) {
    const rows = await db.inboundEvent.findMany({ where: { workspaceId, status: "pending", connection: { status: "active" }, AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }] }, include: { connection: true }, orderBy: { receivedAt: "asc" }, take: 100 });
    for (const event of rows) {
      const token = crypto.randomUUID();
      if (!(await db.inboundEvent.updateMany({ where: { id: event.id, status: "pending", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 300000) } })).count) continue;
      const linked = await db.affair.findMany({ where: { workspaceId, status: { in: ["watching", "active"] }, connectionId: event.connectionId }, orderBy: { lastActivityAt: "desc" }, take: 20 });
      const others = linked.length < 20 ? await db.affair.findMany({ where: { workspaceId, status: "active", id: { notIn: linked.map(a => a.id) } }, orderBy: { lastActivityAt: "desc" }, take: 20 - linked.length }) : [];
      const candidates = [...linked, ...others];
      try {
        const proposal = proposalSchema.parse(await ports.assessor.assess({ event: { id: event.id, externalId: event.externalId, title: event.title, body: event.body, url: event.url, occurredAt: event.occurredAt.toISOString(), connectionKind: event.connection.kind as ConnectionKind }, affairs: candidates.map(a => ({ id: a.id, title: a.title, goal: a.goal, summary: a.summary })) }));
        if (proposal.affairId && !candidates.some(a => a.id === proposal.affairId)) throw new Error("Assessor selected non-candidate affair");
        const chatBound = ports.chat ? await ports.chat.bound() : false;
        await db.$transaction(async tx => {
          const connection = await tx.sourceConnection.findUnique({ where: { id: event.connectionId } });
          if (connection?.status !== "active") {
            await tx.inboundEvent.updateMany({ where: { id: event.id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
            return;
          }
          const affair = proposal.affairId ? await tx.affair.findFirst({ where: { workspaceId, id: proposal.affairId, status: { in: ["active", "watching"] } } }) : null;
          if (!(await tx.inboundEvent.updateMany({ where: { id: event.id, status: "pending", leaseToken: token }, data: { status: "assessed", disposition: proposal.disposition, affairId: affair?.id ?? null, leaseToken: null, leaseUntil: null, lastError: null, nextAttemptAt: null } })).count) return;
          await tx.eventAssessment.create({ data: { workspaceId, eventId: event.id, assessor: ports.assessor.name, disposition: proposal.disposition, whatHappened: proposal.whatHappened, whyItMatters: proposal.whyItMatters, important: proposal.important, createdAt: now } });
          if (affair && proposal.disposition !== "ignore") {
            await tx.affairEntry.create({ data: { workspaceId, affairId: affair.id, actor: "source", kind: "change", text: `${proposal.whatHappened}\n${proposal.whyItMatters}`, data: { eventId: event.id, important: proposal.important }, at: now } });
            await tx.affair.update({ where: { id: affair.id }, data: { lastActivityAt: now, revision: { increment: 1 } } });
            if (proposal.disposition === "notify") await enqueueNotification(tx, { workspaceId, affairId: affair.id, level: affair.notify === "now" ? "now" : affair.notify === "web" ? "web" : "digest", title: event.title.slice(0, 200), body: `${proposal.whatHappened}\n${proposal.whyItMatters}\n查看事项了解详情。`.slice(0, 2000), urgent: proposal.important && affair.notify === "now", dedupeKey: `event:${event.id}` }, { now, chatBound, publicUrl: ports.publicUrl });
            if (proposal.disposition === "wake_affair" && affair.agentState !== "running") await queueAffair(tx, affair.id, "source_change", now);
          }
          await tx.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, agentName: ports.assessor.name, agentAvailable: true }, update: { agentName: ports.assessor.name, agentAvailable: true, agentLastError: null } });
          await audit(tx, { workspaceId, kind: "event_assessed", actor: "chrona", subjectId: event.id, details: { disposition: proposal.disposition, affairId: affair?.id ?? null } });
        });
      } catch (error) {
        const unavailable = error instanceof AgentUnavailableError;
        const attempts = event.attempts + (unavailable ? 0 : 1), failed = attempts >= 5;
        const retryCount = unavailable ? await db.audit.count({ where: { workspaceId, kind: "event_assessment_failed", subjectId: event.id } }) : attempts - 1;
        await db.$transaction(async tx => {
          if (!(await tx.inboundEvent.updateMany({ where: { id: event.id, status: "pending", leaseToken: token }, data: { status: failed ? "failed" : "pending", attempts, lastError: unavailable ? "Assessor unavailable" : "Invalid assessment", nextAttemptAt: failed ? null : new Date(now.getTime() + backoff(retryCount)), leaseToken: null, leaseUntil: null } })).count) return;
          if (unavailable) await tx.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, agentName: ports.assessor.name, agentAvailable: false, agentLastError: "Assessor unavailable" }, update: { agentName: ports.assessor.name, agentAvailable: false, agentLastError: "Assessor unavailable" } });
          const affairId = event.affairId ?? linked[0]?.id;
          if (failed && affairId) await tx.affairEntry.create({ data: { workspaceId, affairId, actor: "chrona", kind: "note", text: "来源事件连续五次无法评估，请检查连接详情。", data: { eventId: event.id }, at: now } });
          await audit(tx, { workspaceId, kind: "event_assessment_failed", actor: "chrona", subjectId: event.id, details: { unavailable, attempts, failed } });
        });
      }
    }
  }
  return {
    list: async () => Promise.all((await db.sourceConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } })).map(async row => toConnection(row, await db.inboundEvent.count({ where: { connectionId: row.id, status: "pending" } }), await db.inboundEvent.count({ where: { connectionId: row.id, status: "failed" } })))),
    detail: async (id: string) => { const row = await requireConnection(id); return { connection: toConnection(row, await db.inboundEvent.count({ where: { connectionId: id, status: "pending" } }), await db.inboundEvent.count({ where: { connectionId: id, status: "failed" } })), events: (await db.inboundEvent.findMany({ where: { workspaceId, connectionId: id }, orderBy: { receivedAt: "desc" }, take: 100 })).map(toInboundEvent) }; },
    create: async (raw: unknown) => {
      const input = parseInput(createConnectionSchema, raw), adapter = ports.sources.find(s => s.kind === input.kind);
      return db.$transaction(async tx => {
        const row = await tx.sourceConnection.create({ data: { ...input, workspaceId, mode: adapter?.mode ?? "poll", coverageNote: adapter?.coverageNote ?? "Source adapter unavailable", status: adapter ? "active" : "needs_authorization", nextCheckAt: ports.now() } });
        await audit(tx, { workspaceId, kind: "connection_created", actor: "user", subjectId: row.id, details: {} });
        return toConnection(row);
      });
    },
    transition: async (id: string, raw: unknown) => {
      const { action } = parseInput(connectionTransitionSchema, raw);
      return db.$transaction(async tx => {
        const row = await tx.sourceConnection.findFirst({ where: { id, workspaceId } });
        if (!row) throw new StewardError("not_found", "Connection not found");
        if (row.status === "revoked") throw new StewardError("conflict", "Connection revoked");
        const updated = await tx.sourceConnection.update({ where: { id }, data: { status: action === "pause" ? "paused" : action === "resume" ? "active" : "revoked", revision: { increment: 1 }, leaseToken: null, leaseUntil: null, nextCheckAt: action === "resume" ? ports.now() : null } });
        await audit(tx, { workspaceId, kind: "connection_transition", actor: "user", subjectId: id, details: { action } });
        return toConnection(updated);
      });
    },
    syncConnection, sync: syncConnection, assessPending,
    pollDue: async (now = ports.now()) => {
      const rows = await db.sourceConnection.findMany({ where: { workspaceId, status: "active", mode: "poll", nextCheckAt: { lte: now }, OR: [{ pollIntervalSeconds: { not: null } }, { affairs: { some: { status: "watching" } } }] } });
      for (const row of rows) await syncConnection(row.id, now);
    },
  };
}
