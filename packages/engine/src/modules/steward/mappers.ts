import * as c from "@chrona/contracts/steward";
import type { Prisma, PrismaClient } from "@chrona/db";
export type Actor = { workspaceId: string; actorKey: string; canWrite: boolean };
export type Ports = { chatRecipients?: string[]; db: PrismaClient; sources: Record<c.ConnectionKind, c.SourceAdapter>; assessor: c.Assessor; deliveryAdapters?: Record<string, c.DeliveryAdapter & { idempotent?: boolean }>; now?: () => Date; authorize: (write: boolean) => Promise<Actor> };
export type Context = Ports & { now: () => Date; actor: Actor };
export type Tx = Prisma.TransactionClient;
export class StewardError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND" | "REVISION_CONFLICT" | "SYNC_REFUSED" | "INVALID_TRANSITION", message: string) { super(message); this.name = "StewardError"; }
}
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
// Select only contract fields: persistence metadata and source config never leave the module.
function view<T>(schema: { shape: Record<string, unknown>; parse: (value: unknown) => T }, row: object): T {
  const data = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  return schema.parse(Object.fromEntries(Object.keys(schema.shape).map(key => [key, data[key]])));
}
export const affairView = (row: object, count = 0) => view(c.affairSchema, { ...row, openAttentionCount: count });
export const eventView = (row: object) => view(c.inboundEventSchema, row);
export const delegationView = (row: object) => view(c.delegationSchema, row);
export const attentionView = (row: object & { affair?: { title: string } | null }) => view(c.attentionItemSchema, { ...row, affairTitle: row.affair?.title ?? null });
export const notificationView = (row: object) => view(c.notificationSchema, row);
export const followUpView = (row: object) => view(c.followUpSchema, row);
export const toolView = (row: object) => view(c.managedToolSchema, row);
export const connectionView = (row: object, pendingEvents: number, failedEvents: number, coverageNote: string) => view(c.connectionSchema, { ...row, pendingEvents, failedEvents, coverageNote });
export async function audit(tx: Tx, ctx: Context, kind: string, subjectId: string, details: unknown) {
  await tx.stewardAudit.create({ data: { workspaceId: ctx.actor.workspaceId, actorKey: ctx.actor.actorKey, kind, subjectId, details: json(details), createdAt: ctx.now() } });
}
export async function requireAffair(ctx: Context, id: string, tx: Tx = ctx.db) {
  const row = await tx.affair.findFirst({ where: { id, workspaceId: ctx.actor.workspaceId } });
  if (!row) throw new StewardError("NOT_FOUND", "Affair not found"); return row;
}
// Serialize client transactions, including different service instances sharing the client.
const queues = new WeakMap<object, Promise<unknown>>();
export function serial<T>(db: object, run: () => Promise<T>): Promise<T> {
  const result = (queues.get(db) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(db, result.catch(() => {})); return result;
}
