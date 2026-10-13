import type { AttentionStatus, EventStatus } from "@chrona/contracts/steward";
import { type Ports, type Context, serial, StewardError, delegationView, affairView, eventView, notificationView, followUpView, toolView } from "./mappers";
import { createConnection, transitionConnection, mappedConnection } from "./connections";
import { syncConnection } from "./ingest";
import { processPendingEvents } from "./process";
import { createAffair, updateAffair, affairDetail, linkEvent } from "./affairs";
import { proposeDelegation, transitionDelegation } from "./delegations";
import { listAttention, decideAttention, today, health } from "./reads";
import { createStewardDelivery } from "./delivery";
import { createStewardFollowUps } from "./follow-ups";
import { schedule } from "./schedule";
import { tick } from "./tick";
export { StewardError } from "./mappers";
export type { Ports as StewardPorts, Actor as StewardActor } from "./mappers";
export function createStewardService(ports: Ports) {
  async function run<T>(write: boolean, fn: (ctx: Context) => Promise<T>) {
    const actor = await ports.authorize(write);
    if (!actor.workspaceId || (write && !actor.canWrite)) throw new StewardError("FORBIDDEN", "Workspace access required");
    const ctx = { ...ports, actor, now: ports.now ?? (() => new Date()) };
    return serial(ports.db, () => fn(ctx));
  }
  return {
    connections: {
      create: (raw: unknown) => run(true, ctx => createConnection(ctx, raw)),
      transition: (id: string, raw: unknown) => run(true, ctx => transitionConnection(ctx, id, raw)),
      list: () => run(false, async ctx => { const rows = await ctx.db.sourceConnection.findMany({ where: { workspaceId: ctx.actor.workspaceId } }); return Promise.all(rows.map(r => mappedConnection(ctx, r.id))); }),
    },
    syncConnection: (id: string) => run(true, ctx => syncConnection(ctx, id)),
    processPendingEvents: (input: { limit?: number } = {}) => run(true, ctx => processPendingEvents(ctx, input)),
    affairs: {
      create: (raw: unknown) => run(true, ctx => createAffair(ctx, raw)),
      update: (id: string, raw: unknown) => run(true, ctx => updateAffair(ctx, id, raw)),
      detail: (id: string) => run(false, ctx => affairDetail(ctx, id)),
      list: () => run(false, async ctx => { const rows = await ctx.db.affair.findMany({ where: { workspaceId: ctx.actor.workspaceId }, include: { _count: { select: { attentionItems: { where: { status: "open" } } } } } }); return rows.map(r => affairView(r, r._count.attentionItems)); }),
    },
    linkEvent: (id: string, raw: unknown) => run(true, ctx => linkEvent(ctx, id, raw)),
    events: { list: (filters: { status?: EventStatus; connectionId?: string } = {}) => run(false, async ctx => (await ctx.db.inboundEvent.findMany({ where: { workspaceId: ctx.actor.workspaceId, status: filters.status, connectionId: filters.connectionId }, orderBy: { receivedAt: "desc" } })).map(eventView)) },
    notifications: {
      list: () => run(false, async ctx => (await delivery(ctx).list()).map(notificationView)),
      acknowledge: (id: string) => run(true, async ctx => notificationView(await delivery(ctx).acknowledge(id))),
      retry: (id: string) => run(true, async ctx => notificationView(await delivery(ctx).retryFailed(id))),
    },
    followUps: {
      complete: (id: string) => run(true, async ctx => followUpView(await followUps(ctx).completeFollowUp(id))),
      cancel: (id: string) => run(true, async ctx => followUpView(await followUps(ctx).cancelFollowUp(id))),
    },
    tools: { list: () => run(false, async ctx => (await ctx.db.managedTool.findMany({ where: { workspaceId: ctx.actor.workspaceId }, orderBy: { createdAt: "desc" } })).map(toolView)) },
    schedule: (from: string, to: string) => run(false, ctx => schedule(ctx, from, to)),
    tick: () => run(true, tick),
    delegations: {
      propose: (raw: unknown) => run(true, ctx => proposeDelegation(ctx, raw)),
      transition: (id: string, raw: unknown) => run(true, ctx => transitionDelegation(ctx, id, raw)),
      list: () => run(false, async ctx => (await ctx.db.delegation.findMany({ where: { workspaceId: ctx.actor.workspaceId } })).map(delegationView)),
    },
    attention: { list: (status?: AttentionStatus) => run(false, ctx => listAttention(ctx, status)), decide: (id: string, raw: unknown) => run(true, ctx => decideAttention(ctx, id, raw)) },
    today: () => run(false, today), health: () => run(false, health),
  };
}
function delivery(ctx: Context) {
  return createStewardDelivery({ db: ctx.db, workspaceId: ctx.actor.workspaceId, actorKey: ctx.actor.actorKey, adapters: ctx.deliveryAdapters ?? {}, now: ctx.now });
}
function followUps(ctx: Context) {
  return createStewardFollowUps({ db: ctx.db, workspaceId: ctx.actor.workspaceId, actorKey: ctx.actor.actorKey, now: ctx.now });
}
export type StewardService = ReturnType<typeof createStewardService>;
