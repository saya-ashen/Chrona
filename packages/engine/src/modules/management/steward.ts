import { notificationPolicySchema } from "@chrona/contracts/steward";
import { db, withDatabaseTransaction } from "@/lib/db";
import { managementStewardCaptureSchema, managementStewardDelegationSchema, managementStewardReadSchema, managementStewardSearchSchema, managementStewardTodaySchema } from "@chrona/contracts/api";
import { captureSteward, StewardError } from "../steward";
import { affairView, attentionView, delegationView, followUpView, toolView } from "../steward/mappers";
import { stableJsonHash } from "../ai";
import { refreshManagementClient, type ManagementIdentity } from "./clients";
import { requireScopes } from "./reads";
import { ManagementError } from "./errors";
import { commandReceipt, managementJson } from "./receipts";

export const isStewardTool = (name: string) => name.startsWith("chrona_steward_");
async function assertReferences(workspaceId: string, input: { affairId?: string; connectionId?: string }) {
  if (input.affairId && !await db.affair.findFirst({ where: { id: input.affairId, workspaceId }, select: { id: true } })) throw new ManagementError("NOT_FOUND", "Affair not found");
  if (input.connectionId && !await db.sourceConnection.findFirst({ where: { id: input.connectionId, workspaceId }, select: { id: true } })) throw new ManagementError("NOT_FOUND", "Connection not found");
}
export async function callManagementSteward(client: ManagementIdentity, name: string, raw: unknown) {
  const writing = name === "chrona_steward_capture" || name === "chrona_steward_delegation_propose";
  const scopes = writing ? ["steward:propose"] : ["steward:read"];
  requireScopes(client, scopes);
  const workspaceId = client.workspaceId;
  if (name === "chrona_steward_affair_search") {
    const input = managementStewardSearchSchema.parse(raw);
    const rows = await db.affair.findMany({ where: { workspaceId, status: input.status, ...(input.query ? { OR: [{ title: { contains: input.query } }, { summary: { contains: input.query } }] } : {}) }, take: input.limit, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { id: true, title: true, status: true, _count: { select: { attentionItems: { where: { status: "open" } } } } } });
    return { items: rows.map(row => ({ id: row.id, title: row.title.slice(0, 200), status: row.status, openAttentionCount: row._count.attentionItems })) };
  }
  if (name === "chrona_steward_affair_read") {
    const { affairId } = managementStewardReadSchema.parse(raw);
    await assertReferences(workspaceId, { affairId });
    const where = { workspaceId, affairId };
    const affair = await db.affair.findFirstOrThrow({ where: { id: affairId, workspaceId } });
    const events = await db.inboundEvent.findMany({ where, take: 20, orderBy: { receivedAt: "desc" }, select: { id: true, title: true, body: true, linkStatus: true, occurredAt: true } });
    return { affair: affairView(affair, await db.attentionItem.count({ where: { ...where, status: "open" } })),
      attention: (await db.attentionItem.findMany({ where, take: 20, orderBy: { createdAt: "desc" }, include: { affair: true } })).map(attentionView),
      events: events.map(({ body, ...event }) => ({ ...event, title: event.title.slice(0, 500), excerpt: body.slice(0, 500) })),
      delegations: (await db.delegation.findMany({ where, take: 20, orderBy: { createdAt: "desc" } })).map(delegationView),
      followUps: (await db.followUp.findMany({ where, take: 20, orderBy: { dueAt: "asc" } })).map(followUpView),
      tools: (await db.managedTool.findMany({ where, take: 20, orderBy: { createdAt: "desc" } })).map(toolView),
    };
  }
  if (name === "chrona_steward_today") {
    managementStewardTodaySchema.parse(raw);
    const now = new Date();
    const section = async (kinds: string[]) => (await db.attentionItem.findMany({ where: { workspaceId, kind: { in: kinds }, OR: [{ status: "open" }, { status: "snoozed", snoozedUntil: { lte: now } }] }, take: 10, orderBy: { createdAt: "desc" }, include: { affair: true } })).map(row => attentionView(Object.assign({}, row, { status: "open" })));
    const state = await db.stewardState.findUnique({ where: { workspaceId } });
    const oldest = await db.inboundEvent.findFirst({ where: { workspaceId, status: "pending" }, orderBy: { receivedAt: "asc" }, select: { receivedAt: true } });
    return { generatedAt: now.toISOString(), decisions: await section(["decision"]), changes: await section(["change", "failure"]), commitments: await section(["commitment"]), suggestions: await section(["suggestion"]), results: await section(["result"]),
      upcoming: (await db.followUp.findMany({ where: { workspaceId, status: "pending" }, take: 10, orderBy: { dueAt: "asc" } })).map(row => ({ id: row.id, kind: "follow_up", title: row.note.slice(0, 200), startsAt: row.dueAt, endsAt: null, affairId: row.affairId, sourceRef: row.id, confirmed: true })),
      health: { assessor: { available: state?.assessorAvailable ?? false, name: (state?.assessorName ?? "Unavailable").slice(0, 200), lastError: state?.assessorLastError ? "Assessor reported an error; review in Chrona" : null }, pendingEvents: await db.inboundEvent.count({ where: { workspaceId, status: "pending" } }), failedEvents: await db.inboundEvent.count({ where: { workspaceId, status: "failed" } }), oldestPendingAt: oldest?.receivedAt ?? null, queuedNotifications: await db.stewardNotification.count({ where: { workspaceId, status: "queued" } }), failedNotifications: await db.stewardNotification.count({ where: { workspaceId, status: { in: ["failed", "uncertain"] } } }), failingConnections: await db.sourceConnection.count({ where: { workspaceId, status: "failing" } }), lastTickAt: state?.lastTickAt ?? null },
    };
  }
  const input = name === "chrona_steward_capture" ? managementStewardCaptureSchema.parse(raw) : managementStewardDelegationSchema.parse(raw);
  try {
    return await withDatabaseTransaction(async () => {
      const authorized = await refreshManagementClient(client); requireScopes(authorized, scopes);
      const payloadHash = stableJsonHash(input);
      if (!input.dryRun) {
        const prior = await db.managementCommand.findUnique({ where: { clientId_toolName_requestId: { clientId: authorized.id, toolName: name, requestId: input.requestId } } });
        if (prior) {
          if (prior.payloadHash !== payloadHash) throw new ManagementError("IDEMPOTENCY_CONFLICT", "requestId already identifies a different command");
          return commandReceipt(prior, true);
        }
      }
      await assertReferences(workspaceId, input);
      if (input.dryRun) return name === "chrona_steward_capture" ? captureSteward(db, workspaceId, authorized.id, authorized.name, managementStewardCaptureSchema.parse(raw)) : { dryRun: true, proposedStatus: "proposed", permissionsGranted: false };
      const command = await db.managementCommand.create({ data: { clientId: authorized.id, workspaceId, toolName: name, requestId: input.requestId, payloadHash, input: managementJson(input) } });
      let result: unknown;
      if (name === "chrona_steward_capture") result = await captureSteward(db, workspaceId, authorized.id, authorized.name, managementStewardCaptureSchema.parse(raw));
      else {
        const { requestId: _requestId, dryRun: _dryRun, ...proposal } = managementStewardDelegationSchema.parse(raw);
        const delegation = await db.delegation.create({ data: { ...proposal, notification: proposal.notification ?? notificationPolicySchema.parse({}), workspaceId, status: "proposed", expiresAt: proposal.expiresAt ? new Date(proposal.expiresAt) : null } });
        const nextStep = "Not granted. Review and grant this proposal on the Delegations page in Chrona.";
        await db.attentionItem.create({ data: { workspaceId, affairId: delegation.affairId, delegationId: delegation.id, kind: "decision", dedupeKey: `delegation-proposal:${delegation.id}`, title: "Review proposed delegation", whatHappened: proposal.purpose, whyItMatters: `Proposed by ${authorized.name}`, nextStep } });
        await db.stewardAudit.create({ data: { workspaceId, actorKey: authorized.id, kind: "management_delegation_proposed", subjectId: delegation.id, details: { commandId: command.id } } });
        result = { delegation: delegationView(delegation), permissionsGranted: false, nextStep, url: new URL("/delegations", authorized.publicUrl).href };
      }
      return commandReceipt(await db.managementCommand.update({ where: { id: command.id }, data: { state: "completed", phase: "completed", result: managementJson(result) } }));
    });
  } catch (error) { if (error instanceof StewardError) throw new ManagementError(error.code === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN", error.message); throw error; }
}
