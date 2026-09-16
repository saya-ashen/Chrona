import { beforeEach, describe, expect, it } from "bun:test";
import { db, withDatabaseTransaction } from "@/lib/db";
import { resetTestDb, seedWorkspace } from "@chrona/db/test-support";
import { createChronaEngine } from "../../engine";
import { createManagementClient, requireManagementClient, revokeManagementClient } from "./clients";

const engine = createChronaEngine();
const proposal = () => ({
  requestId: crypto.randomUUID(), title: "Find funded PhD opportunities",
  description: "A continuing research-position search, not an application submission.",
  rationale: "Relevant openings change during the application cycle.",
  firstStep: "Review the proposed sources and cadence.",
  expectedOutcome: "A useful shortlist of verified matching openings.",
  permissionRequest: "Search public pages; ask before reading files or contacting anyone.",
  sourceSummary: "The user explicitly requested help with an ongoing search.",
});
async function assistant(readOnly = false) {
  const created = await createManagementClient({ name: "Everyday agent", publicUrl: "http://localhost:3101", scopes: readOnly ? ["goals:read"] : ["goals:read", "goals:propose"] });
  return requireManagementClient(created.token);
}
function data(value: unknown): Record<string, any> { return value as Record<string, any>; }
beforeEach(resetTestDb);

describe("Goal management capture without execution authority", () => {
  it("discovers only actually implemented Goal capabilities without exposing provider configuration", async () => {
    const identity = await assistant();
    await db.aiClient.create({ data: { name: "Unrelated provider", type: "debug", config: {}, enabled: true } });
    const result = data(await engine.management.call(identity, "chrona_context_read", {}));
    expect(result.ok).toBe(true);
    expect(result.data.aiClients).toEqual([]);
    expect(result.data.defaults.aiClientId).toBeNull();
    expect(result.data.capabilities.goals).toMatchObject({ available: true, contractVersion: 1, canRead: true, canPropose: true, proposalModes: ["new_draft"], activation: false, policyGrants: false });
    expect(result.data.capabilities.reminders.deliveryChannels).toEqual([]);
  });

  it("creates an inspectable Draft atomically, with requested rather than granted authority", async () => {
    const identity = await assistant();
    const input = proposal();
    const result = data(await engine.management.call(identity, "chrona_goal_propose", input));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ state: "completed", phase: "completed", taskId: null, replayed: false });
    const { goalId } = result.data.result.goal;
    expect(result.data.result).toMatchObject({ outcome: "goal_proposed", requiresHumanReview: true, executionStarted: false, permissionsGranted: false, goal: { status: "Draft" } });
    const stored = await db.goal.findUniqueOrThrow({ where: { id: goalId } });
    expect(stored).toMatchObject({ workspaceId: identity.workspaceId, status: "Draft", nextReviewAt: null });
    expect(stored.successCriteria).toEqual([{ id: "proposed-outcome", kind: "user_confirmed", description: input.expectedOutcome, satisfied: false, confirmedAt: null, proposalStatus: "proposed" }]);
    const audit = await db.event.findFirst({ where: { eventType: "goal.created" } });
    expect(audit).toMatchObject({ actorType: "agent", actorId: identity.id, source: "management_mcp" });
    expect(audit?.payload).toMatchObject({ goal_id: goalId, proposal_only: true, source_summary: input.sourceSummary });
    expect(await Promise.all([db.task.count(), db.taskTrigger.count(), db.taskOccurrence.count(), db.taskPlan.count(), db.run.count(), db.goalReviewProposal.count()])).toEqual([0, 0, 0, 0, 0, 0]);
    const read = data(await engine.management.call(identity, "chrona_goal_read", { goalId, view: "brief" }));
    expect(read.data.brief).toMatchObject({ strategy: input.rationale, currentFocus: input.firstStep, constraints: [input.permissionRequest] });
    expect(read.data).toMatchObject({ permissionGrantsAvailable: false, activationAvailable: false });
  });

  it("replays the immutable receipt and rejects reused request IDs with different intent", async () => {
    const identity = await assistant(), input = proposal();
    const first = data(await engine.management.call(identity, "chrona_goal_propose", input));
    const goalId = first.data.result.goal.goalId;
    await db.goal.update({ where: { id: goalId }, data: { title: "Human correction" } });
    const replay = data(await engine.management.call(identity, "chrona_goal_propose", input));
    expect(replay.data).toMatchObject({ commandId: first.data.commandId, replayed: true, result: first.data.result });
    expect(await db.goal.count()).toBe(1);
    expect(await db.managementCommand.count()).toBe(1);
    const conflict = data(await engine.management.call(identity, "chrona_goal_propose", { ...input, title: "Different intent" }));
    expect(conflict.error.code).toBe("IDEMPOTENCY_CONFLICT");
    const read = data(await engine.management.call(identity, "chrona_goal_read", { goalId }));
    expect(read.data.goal.title).toBe("Human correction");
    expect(read.data.revision).not.toBe(first.data.result.revision);
  });

  it("serializes concurrent identical requests without duplicate Goals or audit events", async () => {
    const identity = await assistant(), input = proposal();
    const results = (await Promise.all(Array.from({ length: 3 }, () => engine.management.call(identity, "chrona_goal_propose", input)))).map(data);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(new Set(results.map((result) => result.data.commandId)).size).toBe(1);
    expect(await db.goal.count()).toBe(1);
    expect(await db.event.count({ where: { eventType: "goal.created" } })).toBe(1);
  });

  it("rolls back the draft, audit and receipt together when the enclosing transaction fails", async () => {
    const identity = await assistant();
    await expect(withDatabaseTransaction(async () => {
      const result = data(await engine.management.call(identity, "chrona_goal_propose", proposal()));
      expect(result.ok).toBe(true);
      throw new Error("Rollback fixture");
    })).rejects.toThrow("Rollback fixture");
    expect(await db.goal.count()).toBe(0);
    expect(await db.event.count()).toBe(0);
    expect(await db.managementCommand.count()).toBe(0);
  });

  it("dry-runs without persisting commands, goals or source context", async () => {
    const identity = await assistant();
    const result = data(await engine.management.call(identity, "chrona_goal_propose", { ...proposal(), dryRun: true }));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ dryRun: true, proposedStatus: "Draft", executionStarted: false, permissionsGranted: false });
    expect(await db.goal.count()).toBe(0);
    expect(await db.managementCommand.count()).toBe(0);
    expect(await db.event.count()).toBe(0);
  });

  it("does not silently widen legacy read/full clients, and proposal clients cannot self-approve or execute", async () => {
    const legacy = await createManagementClient({ name: "Legacy full", publicUrl: "http://localhost:3101" });
    const legacyIdentity = await requireManagementClient(legacy.token);
    expect(legacyIdentity.scopes).not.toContain("goals:read");
    const denied = data(await engine.management.call(legacyIdentity, "chrona_goal_search", {}));
    expect(denied.error.code).toBe("FORBIDDEN");
    const identity = await assistant();
    const taskWrite = data(await engine.management.call(identity, "chrona_task_create", { requestId: crypto.randomUUID(), title: "Escalation", mode: "automatic", start: "now" }));
    expect(taskWrite.error.code).toBe("FORBIDDEN");
    const grant = data(await engine.management.call(identity, "chrona_goal_action", { action: "approve", approved: true }));
    expect(grant.error.code).toBe("VALIDATION_ERROR");
    const readonly = await assistant(true);
    expect(data(await engine.management.call(readonly, "chrona_goal_propose", proposal())).error.code).toBe("FORBIDDEN");
    expect(await db.managementCommand.count()).toBe(0);
  });

  it("rejects implicit workspace, execution, approval and existing-goal mutations", async () => {
    const identity = await assistant();
    for (const extra of [{ workspaceId: "foreign" }, { status: "Active" }, { autoExecute: true }, { nextReviewAt: new Date().toISOString() }, { approved: true }, { goalId: "existing" }]) {
      const result = data(await engine.management.call(identity, "chrona_goal_propose", { ...proposal(), ...extra }));
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await db.goal.count()).toBe(0);
  });

  it("isolates workspace lookup, bounds pagination, and exposes no raw asset or provider state", async () => {
    const identity = await assistant();
    const own = data(await engine.management.call(identity, "chrona_goal_propose", proposal())).data.result.goal.goalId;
    const foreignWorkspace = await seedWorkspace("Foreign");
    const foreign = await db.goal.create({ data: { workspaceId: foreignWorkspace.workspaceId, title: "Private foreign goal", status: "Active", successCriteria: [] } });
    expect(data(await engine.management.call(identity, "chrona_goal_read", { goalId: foreign.id })).error.code).toBe("NOT_FOUND");
    await db.goal.update({ where: { id: own }, data: { operationalBrief: { outcome: "Chosen goal", currentFocus: "Review", strategy: "Check evidence", constraints: [], rawProviderPayload: "MUST_NOT_LEAK" } } });
    const read = data(await engine.management.call(identity, "chrona_goal_read", { goalId: own, view: "brief" }));
    expect(JSON.stringify(read)).not.toContain("MUST_NOT_LEAK");
    const search = data(await engine.management.call(identity, "chrona_goal_search", { status: "Draft", pageSize: 1 }));
    expect(search.data).toMatchObject({ total: 1, page: 1, pageSize: 1, hasMore: false });
    expect(search.data.items[0].goalId).toBe(own);
    expect(data(await engine.management.call(identity, "chrona_goal_search", { pageSize: 21 })).error.code).toBe("VALIDATION_ERROR");
    expect(data(await engine.management.call(identity, "chrona_goal_read", { goalId: own, view: "raw" })).error.code).toBe("VALIDATION_ERROR");
  });

  it("rechecks revoked/reduced authority even for prior successful receipts", async () => {
    const identity = await assistant(), input = proposal();
    expect(data(await engine.management.call(identity, "chrona_goal_propose", input)).ok).toBe(true);
    await db.managementClient.update({ where: { id: identity.id }, data: { scopes: ["goals:read"] } });
    expect(data(await engine.management.call(identity, "chrona_goal_propose", input)).error.code).toBe("FORBIDDEN");
    await revokeManagementClient(identity.id);
    expect(data(await engine.management.call(identity, "chrona_goal_read", { goalId: "anything" })).error.code).toBe("AUTH_REQUIRED");
  });
});
