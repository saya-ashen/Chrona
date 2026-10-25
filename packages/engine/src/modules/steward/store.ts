import type * as db from "@chrona/db";
import * as c from "@chrona/contracts/steward";
/** Only schema keys cross the boundary; payloads, tokens and delivery leases stay private. */
function project<T>(schema: { shape: Record<string, unknown>; parse(value: unknown): T }, row: object): T {
  const source = row as Record<string, unknown>;
  return schema.parse(Object.fromEntries(Object.keys(schema.shape).map(key => [key, source[key] instanceof Date ? source[key].toISOString() : source[key]])));
}
export const toSession = (row: db.Session & { runs: { id: string }[] }) => project(c.sessionSchema, { ...row, running: row.runs.length > 0 });
export const toSchedule = (row: db.Schedule) => project(c.scheduleSchema, row);
export const toRun = (row: db.Run) => project(c.runSchema, row);
export const toApproval = (row: db.Approval) => project(c.approvalSchema, row);
export const toGrant = (row: db.Grant) => project(c.grantSchema, row);
export const toPreference = (row: db.Preference) => project(c.preferenceSchema, row);
/** Stored attachments. The earliest web replies recorded `path` without `ref`: they keep their name and have no file. */
export function storedAttachments(value: unknown): c.Attachment[] {
  const files = (Array.isArray(value) ? value : []).map(file => (file && typeof file === "object" ? { ...file, ref: (file as { ref?: unknown }).ref ?? null } : file));
  return c.attachmentSchema.strip().array().catch([]).parse(files);
}
export function toMessage(row: db.Message): c.Message {
  const attachments = storedAttachments(row.attachments);
  return c.messageSchema.parse({ id: row.id, direction: row.direction, channel: row.channel, text: row.text, attachments, sessionId: row.sessionId, quotedMessageId: row.quotedMessageId, at: row.at.toISOString() });
}
