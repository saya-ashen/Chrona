import { todayViewSchema, healthSchema, type Health, type Upcoming } from "@chrona/contracts/steward";
import type { RecordContext } from "./affairs";
import * as view from "./store";
export function createToday({ db, workspaceId, now }: RecordContext, agentHealth: () => Health["agent"], sandboxHealth: () => Health["sandbox"] = () => ({ available: false, languages: [] })) {
  async function health() {
    const affairs = await db.affair.findMany({ where: { workspaceId }, select: { agentState: true } });
    return healthSchema.parse({ sandbox: sandboxHealth(), agent: agentHealth(), queuedAffairs: affairs.filter(a => a.agentState === "queued").length, runningAffairs: affairs.filter(a => a.agentState === "running").length, failedAffairs: affairs.filter(a => a.agentState === "failed").length, pendingEvents: await db.inboundEvent.count({ where: { workspaceId, status: "pending" } }), failingConnections: await db.sourceConnection.count({ where: { workspaceId, status: "failing" } }), queuedNotifications: await db.notification.count({ where: { workspaceId, status: "queued" } }), failedNotifications: await db.notification.count({ where: { workspaceId, status: "failed" } }), lastTickAt: (await db.stewardState.findUnique({ where: { workspaceId } }))?.lastTickAt?.toISOString() ?? null });
  }
  return { health, get: async () => {
    const at = now(), affairs = await db.affair.findMany({ where: { workspaceId }, include: { results: { orderBy: { version: "desc" }, take: 1 } } });
    const asks = (await db.ask.findMany({ where: { workspaceId, status: "open" }, include: { affair: true }, orderBy: { createdAt: "asc" } })).map(view.toAsk);
    const changes = (await db.affairEntry.findMany({ where: { workspaceId, kind: "change", at: { gte: new Date(at.getTime() - 48 * 3600000), lte: at } }, include: { affair: true }, orderBy: { at: "desc" } })).filter(r => r.data && typeof r.data === "object" && !Array.isArray(r.data) && r.data.important === true).map(r => ({ ...view.toEntry(r), affairTitle: r.affair.title }));
    const results = affairs.flatMap(a => a.results.filter(r => r.createdAt.getTime() >= at.getTime() - 3 * 86400000 && r.createdAt <= at).map(r => ({ id: r.id, affairId: a.id, affairTitle: a.title, version: r.version, title: r.title, summary: r.summary, createdAt: r.createdAt.toISOString() }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const upcoming: Upcoming[] = (await db.followUp.findMany({ where: { workspaceId, status: "pending", dueAt: { gte: at, lte: new Date(at.getTime() + 7 * 86400000) }, affair: { status: { in: ["active", "watching"] } } }, include: { affair: true } })).map(f => ({ kind: "follow_up", affairId: f.affairId, affairTitle: f.affair.title, note: f.note, at: f.dueAt.toISOString() }));
    for (const a of affairs) if (a.status === "watching" && a.nextCheckAt && a.nextCheckAt >= at && a.nextCheckAt.getTime() <= at.getTime() + 86400000) upcoming.push({ kind: "care_check", affairId: a.id, affairTitle: a.title, note: a.nextStep, at: a.nextCheckAt.toISOString() });
    upcoming.sort((a, b) => a.at.localeCompare(b.at));
    return todayViewSchema.parse({ generatedAt: at.toISOString(), counts: { active: affairs.filter(a => a.status === "active").length, watching: affairs.filter(a => a.status === "watching").length, waiting: new Set(asks.filter(a => a.kind !== "suggestion" && a.affairId).map(a => a.affairId)).size, newResults: results.length }, decisions: asks.filter(a => a.kind !== "suggestion"), changes, results, upcoming, suggestions: asks.filter(a => a.kind === "suggestion"), health: await health() });
  } };
}
