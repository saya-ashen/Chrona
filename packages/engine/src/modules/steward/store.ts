import type { Affair, AffairEntry, AffairResult, Ask, AffairRun, FollowUp, Grant, Preference, ChatMessage, Notification, SourceConnection, InboundEvent, ManagedTool, ToolVersion } from "@chrona/db";
import * as c from "@chrona/contracts/steward";
const iso = (date: Date | null) => date?.toISOString() ?? null;
/** Explicit contract-key projection: private row fields never cross this boundary. */
function project<S extends { shape: Record<string, unknown>; parse(value: unknown): unknown }>(schema: S, row: object): ReturnType<S["parse"]> {
  const source = row as Record<string, unknown>;
  return schema.parse(Object.fromEntries(Object.keys(schema.shape).map(key => [key, source[key] instanceof Date ? source[key].toISOString() : source[key]]))) as ReturnType<S["parse"]>;
}
export function toAffair(row: Affair, openAsks = 0, latest: AffairResult | null = null) {
  return project(c.affairSchema, { ...row, openAsks, care: row.cadenceSeconds === null ? null : { cadenceSeconds: row.cadenceSeconds, notify: row.notify, connectionId: row.connectionId, lastCheckAt: iso(row.lastCheckAt), nextCheckAt: iso(row.nextCheckAt) }, latestResult: latest ? { version: latest.version, title: latest.title, createdAt: iso(latest.createdAt) } : null });
}
export const toEntry = (row: AffairEntry) => project(c.entrySchema, row);
export const toResult = (row: AffairResult) => project(c.resultSchema, row);
export const toAsk = (row: Ask & { affair?: { title: string } | null }) => project(c.askSchema, { ...row, affairTitle: row.affair?.title ?? null });
export const toRun = (row: AffairRun) => project(c.runSchema, row);
export const toFollowUp = (row: FollowUp) => project(c.followUpSchema, row);
export const toGrant = (row: Grant) => project(c.grantSchema, row);
export const toPreference = (row: Preference) => project(c.preferenceSchema, row);
export const toChatMessage = (row: ChatMessage) => project(c.chatMessageSchema, row);
export const toNotification = (row: Notification) => project(c.notificationSchema, row);
export const toConnection = (row: SourceConnection, pendingEvents = 0, failedEvents = 0) => project(c.connectionSchema, { ...row, pendingEvents, failedEvents });
export const toInboundEvent = (row: InboundEvent) => project(c.inboundEventSchema, row);
export const toTool = (row: ManagedTool & { versions: ToolVersion[] }) => {
  const version = row.versions.find(v => v.version === row.version);
  return project(c.toolSchema, { ...row, script: version?.script ?? null, spec: version?.spec ?? null });
};
