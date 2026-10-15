import type * as db from "@chrona/db";
import * as c from "@chrona/contracts/steward";
/** Only schema keys cross the boundary; payloads, tokens and delivery leases stay private. */
function project<T>(schema: { shape: Record<string, unknown>; parse(value: unknown): T }, row: object): T {
  const source = row as Record<string, unknown>;
  return schema.parse(Object.fromEntries(Object.keys(schema.shape).map(key => [key, source[key] instanceof Date ? source[key].toISOString() : source[key]])));
}
export const toAffair = (row: db.Affair, summary: string, nextSchedule: c.Affair["nextSchedule"], running: boolean, openApprovals: number) => project(c.affairSchema, { ...row, summary, nextSchedule, running, openApprovals });
export const toActivity = (row: db.Activity) => project(c.activitySchema, row);
export const toSchedule = (row: db.Schedule) => project(c.scheduleSchema, row);
export const toRun = (row: db.Run) => project(c.runSchema, row);
export const toApproval = (row: db.Approval & { affair?: { title: string } | null }) => project(c.approvalSchema, { ...row, affairTitle: row.affair?.title ?? null });
export const toGrant = (row: db.Grant) => project(c.grantSchema, row);
export const toPreference = (row: db.Preference) => project(c.preferenceSchema, row);
export const toNotification = (row: db.Notification) => project(c.notificationSchema, row);
