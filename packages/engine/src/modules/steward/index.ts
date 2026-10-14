import type { AttentionStatus, EventStatus } from "@chrona/contracts/steward";
import { type Ports, type Context, serial, StewardError, delegationView, affairView, eventView, notificationView, followUpView } from "./mappers";
import { createConnection, transitionConnection, mappedConnection } from "./connections";
import { syncConnection } from "./ingest";
import { getAssessmentMode, setAssessmentMode, refreshExternalHealth } from "./external-assess";
import { processPendingEvents } from "./process";
import { createAffair, updateAffair, affairDetail, linkEvent } from "./affairs";
import { proposeDelegation, transitionDelegation } from "./delegations";
import { listAttention, decideAttention, today, health } from "./reads";
import { createStewardDelivery } from "./delivery";
import { createStewardFollowUps } from "./follow-ups";
import { schedule } from "./schedule";
import { tick } from "./tick";
import { createStewardTools } from "./tools";
type Tools = ReturnType<typeof createStewardTools>;
export { StewardError } from "./mappers";
export { captureSteward } from "./capture";
export type { Ports as StewardPorts, Actor as StewardActor } from "./mappers";
export function createStewardService(ports: Ports) {
  async function run<T>(write: boolean, fn: (ctx: Context) => Promise<T>) {
    const actor = await ports.authorize(write);
    if (!actor.workspaceId || (write && !actor.canWrite)) throw new StewardError("FORBIDDEN", "Workspace access required");
    const ctx = { ...ports, actor, now: ports.now ?? (() => new Date()) };
    return serial(ports.db, () => fn(ctx));
  }
  /** Like run, but `fn` queues its own database phases so model calls do not block other requests. */
  async function runPhased<T>(fn: (ctx: Context, queue: <R>(step: () => Promise<R>) => Promise<R>) => Promise<T>) {
    const actor = await ports.authorize(true);
    if (!actor.workspaceId || !actor.canWrite) throw new StewardError("FORBIDDEN", "Workspace access required");
    return fn({ ...ports, actor, now: ports.now ?? (() => new Date()) }, step => serial(ports.db, step));
  }
  return {
    getAssessmentMode: () => run(false, async ctx => ({ mode: await getAssessmentMode(ctx) })),
    setAssessmentMode: (mode: "builtin" | "external") => run(true, ctx => setAssessmentMode(ctx, mode)),
    connections: {
      create: (raw: unknown) => run(true, ctx => createConnection(ctx, raw)),
      transition: (id: string, raw: unknown) => run(true, ctx => transitionConnection(ctx, id, raw)),
      list: () => run(false, async ctx => { const rows = await ctx.db.sourceConnection.findMany({ where: { workspaceId: ctx.actor.workspaceId } }); return Promise.all(rows.map(r => mappedConnection(ctx, r.id))); }),
    },
    syncConnection: (id: string) => run(true, ctx => syncConnection(ctx, id)),
    processPendingEvents: (input: { limit?: number } = {}) => runPhased((ctx, serialize) => processPendingEvents(ctx, { ...input, serialize })),
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
    tools: {
      list: (filters: Parameters<Tools["list"]>[1] = {}) => run(false, ctx => tools(ctx).list(ctx.actor.workspaceId, filters)),
      recommend: (input: Parameters<Tools["recommend"]>[1]) => run(false, async ctx => tools(ctx).recommend(ctx.actor.workspaceId, input)),
      generate: (input: Omit<Parameters<Tools["generate"]>[1], "actorKey">) => run(true, ctx => tools(ctx).generate(ctx.actor.workspaceId, { ...input, actorKey: ctx.actor.actorKey })),
      transition: (id: string, input: Omit<Parameters<Tools["transition"]>[2], "actorKey">) => run(true, ctx => tools(ctx).transition(ctx.actor.workspaceId, id, { ...input, actorKey: ctx.actor.actorKey })),
      edit: (id: string, input: Omit<Parameters<Tools["edit"]>[2], "actorKey">) => run(true, ctx => tools(ctx).edit(ctx.actor.workspaceId, id, { ...input, actorKey: ctx.actor.actorKey })),
      run: (id: string, input: Omit<Parameters<Tools["run"]>[2], "actorKey">) => run(true, ctx => tools(ctx).run(ctx.actor.workspaceId, id, { ...input, actorKey: ctx.actor.actorKey })),
    },
    schedule: (from: string, to: string) => run(false, ctx => schedule(ctx, from, to)),
    tick: () => runPhased(tick),
    delegations: {
      propose: (raw: unknown) => run(true, ctx => proposeDelegation(ctx, raw)),
      transition: (id: string, raw: unknown) => run(true, ctx => transitionDelegation(ctx, id, raw)),
      list: () => run(false, async ctx => (await ctx.db.delegation.findMany({ where: { workspaceId: ctx.actor.workspaceId } })).map(delegationView)),
    },
    attention: { list: (status?: AttentionStatus) => run(false, ctx => listAttention(ctx, status)), decide: (id: string, raw: unknown) => run(true, ctx => decideAttention(ctx, id, raw)) },
    today: () => run(false, async ctx => { await refreshExternalHealth(ctx); return today(ctx); }), health: () => run(false, async ctx => { await refreshExternalHealth(ctx); return health(ctx); }),
  };
}
function tools(ctx: Context) {
  return createStewardTools({ db: ctx.db, now: ctx.now });
}
function delivery(ctx: Context) {
  return createStewardDelivery({ db: ctx.db, workspaceId: ctx.actor.workspaceId, actorKey: ctx.actor.actorKey, adapters: ctx.deliveryAdapters ?? {}, now: ctx.now });
}
function followUps(ctx: Context) {
  return createStewardFollowUps({ db: ctx.db, workspaceId: ctx.actor.workspaceId, actorKey: ctx.actor.actorKey, now: ctx.now });
}
export type StewardService = ReturnType<typeof createStewardService>;
