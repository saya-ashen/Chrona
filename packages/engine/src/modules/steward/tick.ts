import type { StewardPorts } from "./service";
import { createConnections } from "./sources";
import { createNotifications } from "./notify";
import { queueAffair } from "./affairs";
import { audit } from "./audit";
/** No external work inside a transaction. Stage failures are isolated and durable. */
export function createTick(ports: StewardPorts) {
  return async function tick(now = ports.now()) {
    const failures: { workspaceId: string; stage: string }[] = [];
    for (const workspace of await ports.db.workspace.findMany({ select: { id: true } })) {
      const workspaceId = workspace.id, sources = createConnections(ports, workspaceId), notifications = createNotifications(ports, workspaceId);
      const stages: [string, () => Promise<unknown>][] = [
        ["poll", () => sources.pollDue(now)],
        ["assess", () => sources.assessPending(now)],
        ["care", () => ports.db.$transaction(async tx => {
          const due = await tx.affair.findMany({ where: { workspaceId, status: "watching", agentState: { in: ["idle", "queued"] }, nextCheckAt: { lte: now }, cadenceSeconds: { not: null } } });
          for (const affair of due) {
            await queueAffair(tx, affair.id, "care_check", now);
            const cadence = affair.cadenceSeconds! * 1000, previous = affair.nextCheckAt!.getTime();
            await tx.affair.update({ where: { id: affair.id }, data: { nextCheckAt: new Date(previous + (Math.floor((now.getTime() - previous) / cadence) + 1) * cadence) } });
          }
        })],
        ["follow_up", () => ports.db.$transaction(async tx => {
          const due = await tx.followUp.findMany({ where: { workspaceId, status: "pending", dueAt: { lte: now }, affair: { status: { in: ["active", "watching"] }, agentState: { in: ["idle", "queued"] } } } });
          for (const follow of due) {
            await queueAffair(tx, follow.affairId, "follow_up_due", now);
            await tx.followUp.update({ where: { id: follow.id }, data: { status: "done" } });
            await audit(tx, { workspaceId, kind: "follow_up_due", actor: "chrona", subjectId: follow.id, details: {} });
          }
        })],
        // E4 consumes queued affairs and their wakeReason; no synthetic runs here.
        ["deliver", () => notifications.deliverDue(now)],
        ["digest", () => notifications.sendDigestIfDue(now)],
      ];
      for (const [stage, run] of stages) {
        try { await run(); }
        catch {
          failures.push({ workspaceId, stage });
          try { await audit(ports.db, { workspaceId, kind: "tick_stage_failed", actor: "chrona", subjectId: workspaceId, details: { stage, at: now.toISOString() } }); } catch { /* Return failure even when persistence itself is unavailable. */ }
        }
      }
      try { await ports.db.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, lastTickAt: now }, update: { lastTickAt: now } }); }
      catch { failures.push({ workspaceId, stage: "lastTickAt" }); }
    }
    return { failures };
  };
}
