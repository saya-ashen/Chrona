import type * as db from "@chrona/db";
import * as c from "@chrona/contracts/steward";
/** Only schema keys cross the boundary; payloads, tokens and delivery leases stay private. */
function project<T>(schema: { shape: Record<string, unknown>; parse(value: unknown): T }, row: object): T {
  const source = row as Record<string, unknown>;
  return schema.parse(Object.fromEntries(Object.keys(schema.shape).map(key => [key, source[key] instanceof Date ? source[key].toISOString() : source[key]])));
}
export const toAffair = (row: db.Affair, view: Pick<c.Affair, "summary" | "nextSchedule" | "running" | "openApprovals" | "work">) => project(c.affairSchema, { ...row, ...view });
export const toActivity = (row: db.Activity) => project(c.activitySchema, row);
export const toSchedule = (row: db.Schedule) => project(c.scheduleSchema, row);
export const toRun = (row: db.Run) => project(c.runSchema, row);
export const toApproval = (row: db.Approval & { affair?: { title: string } | null }) => project(c.approvalSchema, { ...row, affairTitle: row.affair?.title ?? null });
export const toGrant = (row: db.Grant) => project(c.grantSchema, row);
export const toPreference = (row: db.Preference) => project(c.preferenceSchema, row);
export const toNotification = (row: db.Notification) => project(c.notificationSchema, row);
export function toMessage(row: db.Message): c.Message {
  const attachments = c.attachmentSchema.strip().array().parse(row.attachments);
  return c.messageSchema.parse({ id: row.id, direction: row.direction, channel: row.channel, text: row.text, attachments, affairId: row.affairId, quotedMessageId: row.quotedMessageId, at: row.at.toISOString() });
}
