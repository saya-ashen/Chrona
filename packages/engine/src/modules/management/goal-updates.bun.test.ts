import { beforeEach, describe, expect, it } from "bun:test";
import { db, withDatabaseTransaction } from "@/lib/db";
import { resetTestDb, seedWorkspace } from "@chrona/db/test-support";
import { createChronaEngine } from "../../engine";
import { createManagementClient, requireManagementClient, revokeManagementClient } from "./clients";
import { buildAutomaticGoalTaskContext } from "../goals/goal-task-context";
import { updateGoal, updateGoalBrief } from "../goals/goals-write";

const engine = createChronaEngine();
const asData = (value: unknown): Record<string, any> => value as Record<string, any>;
const confirmed = (id: string) => ({ id, kind: "user_confirmed", description: `Criterion ${id}`, satisfied: true, confirmedAt: "2026-01-01T00:00:00.000Z", proposalStatus: "confirmed", evidenceArtifactIds: [`evidence-${id}`] });
async function fixture(status: "Draft" | "Active" | "Paused" | "Achieved" | "Stopped" = "Active") {
  const client = await createManagementClient({ name: "Goal editor", publicUrl: "http://localhost:3101", scopes: ["goals:read", "goals:write"] });
  const identity = await requireManagementClient(client.token);
  const goal = await db.goal.create({ data: { workspaceId: identity.workspaceId, title: "PhD search", description: "Existing context", status, successCriteria: [confirmed("fit"), confirmed("funding")], operationalBrief: { outcome: "Find a position", currentFocus: "Worldwide", strategy: "Verify sources", constraints: ["No outreach"] } } });
  return { identity, goal };
}
const edit = (goalId: string, patch: unknown = { title: "European PhD search" }, expectedRevision = "goal-config-v1:1") => ({ requestId: crypto.randomUUID(), goalId, expectedRevision, reason: "User requested European positions", patch });
const call = async (identity: Awaited<ReturnType<typeof requireManagementClient>>, tool: string, input: unknown) => asData(await engine.management.call(identity, tool, input));
beforeEach(resetTestDb);

describe("existing-Goal editing without execution authority", () => {
  it.each(["Draft", "Active", "Paused"] as const)("edits %s, preserves omitted fields and existing task input, and versions the brief", async (status) => {
    const { identity, goal } = await fixture(status);
    const context = await buildAutomaticGoalTaskContext({ goalId: goal.id, workspaceId: identity.workspaceId });
    const task = await db.task.create({ data: { workspaceId: identity.workspaceId, goalId: goal.id, title: "Already planned", goalContext: context, executionConfig: {}, status: "Ready", priority: "Medium" } });
    const input = edit(goal.id, { title: "European PhD search", brief: { currentFocus: "European funded positions" }, description: null });
    const result = await call(identity, "chrona_goal_update", input);
    expect(result.ok).toBe(true);
    expect(result.data.result).toMatchObject({ outcome: "goal_updated", editRevision: "goal-config-v1:2", existingTaskContextsChanged: false, executionStarted: false, permissionsGranted: false });
    const stored = await db.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(stored).toMatchObject({ title: "European PhD search", description: null, status, nextReviewAt: null, configRevision: 2 });
    expect(stored.successCriteria).toEqual(goal.successCriteria);
    expect(stored.operationalBrief).toMatchObject({ outcome: "Find a position", currentFocus: "European funded positions", strategy: "Verify sources", constraints: ["No outreach"] });
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).goalContext).toEqual(task.goalContext);
    expect(await buildAutomaticGoalTaskContext({ goalId: goal.id, workspaceId: identity.workspaceId })).toMatchObject({ goal: { operationalBrief: { currentFocus: "European funded positions" } } });
    expect(await db.goalBriefRevision.findFirst({ where: { goalId: goal.id } })).toMatchObject({ goalId: goal.id, actorType: "agent", actorId: identity.id, brief: stored.operationalBrief });
    expect(await Promise.all([db.taskTrigger.count(), db.taskOccurrence.count(), db.run.count(), db.taskPlan.count(), db.goalReviewProposal.count()])).toEqual([0, 0, 0, 0, 0]);
    const event = await db.event.findFirst({ where: { eventType: "goal.management_updated" } });
    expect(event).toMatchObject({ actorType: "agent", actorId: identity.id, correlationId: result.data.commandId, payload: { goal_id: goal.id, reason: input.reason, before_revision: "goal-config-v1:1", after_revision: "goal-config-v1:2" } });
  });

  it("previews a bounded diff without changing any Goal, revision, history or receipt", async () => {
    const { identity, goal } = await fixture();
    const input = edit(goal.id, { description: "x".repeat(5_000), brief: { constraints: ["Ask before outreach"] } });
    const preview = await call(identity, "chrona_goal_update", { ...input, dryRun: true });
    expect(preview.ok).toBe(true);
    expect(preview.data).toMatchObject({ dryRun: true, changed: true, editRevision: "goal-config-v1:1" });
    expect(preview.data.changes.find((item: any) => item.field === "description")).toMatchObject({ afterTruncated: true });
    expect(preview.data.changes.find((item: any) => item.field === "brief.constraints")).toMatchObject({ before: '["No outreach"]', after: '["Ask before outreach"]' });
    expect(await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).toEqual(goal);
    expect(await Promise.all([db.managementCommand.count(), db.event.count(), db.goalBriefRevision.count()])).toEqual([0, 0, 0]);
  });

  it("adds/revises/removes criteria by ID without transferring confirmations or deleting untouched evidence", async () => {
    const { identity, goal } = await fixture();
    const result = await call(identity, "chrona_goal_update", edit(goal.id, { criteria: [{ operation: "revise", id: "fit", description: "European fit" }, { operation: "add", id: "visa", description: "Viable visa path" }] }));
    expect(result.ok).toBe(true);
    const criteria = (await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).successCriteria as any[];
    expect(criteria.find((c) => c.id === "funding")).toEqual(confirmed("funding"));
    for (const id of ["fit", "visa"]) expect(criteria.find((c) => c.id === id)).toMatchObject({ satisfied: false, confirmedAt: null, proposalStatus: "proposed", evidenceArtifactIds: [] });
    const remove = await call(identity, "chrona_goal_update", edit(goal.id, { criteria: [{ operation: "remove", id: "visa" }] }, result.data.result.editRevision));
    expect(remove.ok).toBe(true);
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).successCriteria).toHaveLength(2);
  });

  it("rejects missing/duplicate criterion IDs and removing the last criterion atomically", async () => {
    const { identity, goal } = await fixture();
    for (const criteria of [[{ operation: "add", id: "fit", description: "Duplicate" }], [{ operation: "revise", id: "missing", description: "Missing" }], [{ operation: "remove", id: "fit" }, { operation: "remove", id: "funding" }]]) {
      expect((await call(identity, "chrona_goal_update", edit(goal.id, { title: "Must roll back", criteria }))).error.code).toBe("VALIDATION_ERROR");
    }
    expect(await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).toEqual(goal);
    expect(await db.managementCommand.count()).toBe(0);
  });

  it("does not reconstruct long omitted fields from truncated reads or discard unknown brief metadata", async () => {
    const { identity, goal } = await fixture();
    const constraints = Array.from({ length: 18 }, (_, i) => `Constraint ${i} ` + "x".repeat(2_000));
    await db.goal.update({ where: { id: goal.id }, data: { operationalBrief: { outcome: "Long-lived", currentFocus: "Review", strategy: "Original", constraints, internalTag: "preserve-not-expose" } } });
    const read = await call(identity, "chrona_goal_read", { goalId: goal.id, view: "brief" });
    expect(read.data.briefTruncated).toBe(true);
    expect(JSON.stringify(read)).not.toContain("preserve-not-expose");
    expect((await call(identity, "chrona_goal_update", edit(goal.id, { brief: { strategy: "Updated" } }, read.data.editRevision))).ok).toBe(true);
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).operationalBrief).toMatchObject({ constraints, internalTag: "preserve-not-expose" });
  });

  it("initializes an absent brief transparently and keeps same-value edits as no-ops", async () => {
    const { identity, goal } = await fixture();
    const unchanged = await call(identity, "chrona_goal_update", edit(goal.id, { title: goal.title }));
    expect(unchanged.data.result).toMatchObject({ outcome: "unchanged", editRevision: "goal-config-v1:1", changes: [] });
    expect(await db.event.count()).toBe(0);
    const empty = await db.goal.create({ data: { workspaceId: identity.workspaceId, title: "Untitled brief", successCriteria: [confirmed("fit")] } });
    const preview = await call(identity, "chrona_goal_update", { ...edit(empty.id, { brief: { currentFocus: "First review" } }), dryRun: true });
    expect(preview.data.changes.map((c: any) => c.field)).toEqual(["brief.outcome", "brief.currentFocus", "brief.strategy", "brief.constraints"]);
  });

  it("records attributed progress, finding and decision notes with paginated history, not formal evidence", async () => {
    const { identity, goal } = await fixture();
    let revision = "goal-config-v1:1";
    for (const kind of ["progress", "finding", "decision"]) {
      const { patch: _, ...input } = edit(goal.id, undefined, revision);
      const result = await call(identity, "chrona_goal_update", { ...input, note: { kind, text: `${kind}: reviewed two sources` } });
      expect(result.ok).toBe(true); revision = result.data.result.editRevision;
    }
    expect(revision).toBe("goal-config-v1:4");
    const history = await call(identity, "chrona_goal_read", { goalId: goal.id, view: "history", pageSize: 2 });
    expect(history.ok).toBe(true);
    expect(history.data.history).toMatchObject({ total: 3, page: 1, pageSize: 2, hasMore: true, scope: "management_goal_updates", notesAreVerifiedEvidence: false });
    expect(history.data.history.items[0]).toMatchObject({ actorType: "agent", actorId: identity.id, note: { kind: "decision" }, changes: [] });
    const next = await call(identity, "chrona_goal_read", { goalId: goal.id, view: "history", pageSize: 2, page: 2 });
    expect(next.data.history.items).toHaveLength(1);
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).successCriteria).toEqual(goal.successCriteria);
    expect(await db.goalAsset.count()).toBe(0);
  });

  it("bounds large multilingual history pages with explicit truncation and smaller-page detail", async () => {
    const { identity, goal } = await fixture();
    let revision = "goal-config-v1:1";
    for (let i = 0; i < 20; i++) {
      const input = { ...edit(goal.id, { description: `${i}:` + "研究".repeat(2_000), criteria: Array.from({ length: 18 }, (_, n) => ({ operation: i === 0 ? "add" : "revise", id: `c${n}`, description: `${i}:` + "研".repeat(500) })) }, revision), reason: "研".repeat(2_000), note: { kind: "finding", text: "研".repeat(2_000) } };
      const result = await call(identity, "chrona_goal_update", input);
      expect(result.ok).toBe(true); revision = result.data.result.editRevision;
    }
    const page = await call(identity, "chrona_goal_read", { goalId: goal.id, view: "history", pageSize: 20 });
    expect(page.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(131_072);
    expect(page.data.history.items[0]).toMatchObject({ reasonTruncated: true, noteTruncated: true, changesTruncated: true, totalChanges: 19 });
    const detail = await call(identity, "chrona_goal_read", { goalId: goal.id, view: "history", pageSize: 1 });
    expect(detail.data.history.items[0]).toMatchObject({ reasonTruncated: false, noteTruncated: false, changesTruncated: false });
  });

  it("survives a new engine instance and replays an immutable receipt, not a second edit", async () => {
    const { identity, goal } = await fixture(), input = edit(goal.id);
    const first = await call(identity, "chrona_goal_update", input);
    await updateGoal({ goalId: goal.id, patch: { title: "Human follow-up" } });
    const replay = asData(await createChronaEngine().management.call(identity, "chrona_goal_update", input));
    expect(replay.data).toMatchObject({ commandId: first.data.commandId, replayed: true, result: first.data.result });
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).title).toBe("Human follow-up");
    expect(await db.event.count({ where: { eventType: "goal.management_updated" } })).toBe(1);
    expect((await call(identity, "chrona_goal_update", { ...input, reason: "Changed intent" })).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects stale UI/brief changes and A→B→A even with identical timestamps", async () => {
    const { identity, goal } = await fixture();
    await updateGoal({ goalId: goal.id, patch: { title: "Intermediate" } });
    await db.goal.update({ where: { id: goal.id }, data: { title: goal.title, updatedAt: goal.updatedAt } });
    expect((await call(identity, "chrona_goal_update", edit(goal.id))).error.code).toBe("REVISION_CONFLICT");
    const before = (await call(identity, "chrona_goal_read", { goalId: goal.id })).data.editRevision;
    await updateGoalBrief({ goalId: goal.id, brief: { outcome: "Revised", currentFocus: "Review", strategy: "", constraints: [] } });
    expect((await call(identity, "chrona_goal_update", edit(goal.id, { title: "Stale" }, before))).error.code).toBe("REVISION_CONFLICT");
    expect(await db.managementCommand.count()).toBe(0);
  });

  it("serializes competing edits and deduplicates identical retries", async () => {
    const { identity, goal } = await fixture(), input = edit(goal.id);
    const identical = await Promise.all([call(identity, "chrona_goal_update", input), call(identity, "chrona_goal_update", input)]);
    expect(identical.every((r) => r.ok)).toBe(true);
    expect(new Set(identical.map((r) => r.data.commandId)).size).toBe(1);
    const version = identical[0].data.result.editRevision;
    const competing = await Promise.all([call(identity, "chrona_goal_update", edit(goal.id, { title: "A" }, version)), call(identity, "chrona_goal_update", edit(goal.id, { title: "B" }, version))]);
    expect(competing.filter((r) => r.ok)).toHaveLength(1);
    expect(competing.find((r) => !r.ok)?.error.code).toBe("REVISION_CONFLICT");
  });

  it.each(["Achieved", "Stopped"] as const)("does not rewrite the %s outcome archive", async (status) => {
    const { identity, goal } = await fixture(status);
    for (const dryRun of [true, false]) expect((await call(identity, "chrona_goal_update", { ...edit(goal.id), dryRun })).error.code).toBe("PRECONDITION_FAILED");
    expect((await call(identity, "chrona_goal_read", { goalId: goal.id })).data.editability).toMatchObject({ canUpdate: false, disabledReason: "Archived Goal" });
    expect(await db.managementCommand.count()).toBe(0);
  });

  it("isolates cross-workspace edits, previews, and history and does not expose unrelated payload fields", async () => {
    const { identity, goal } = await fixture();
    const foreignWorkspace = await seedWorkspace("Other");
    const foreign = await db.goal.create({ data: { workspaceId: foreignWorkspace.workspaceId, title: "Private", successCriteria: [confirmed("private")] } });
    for (const dryRun of [true, false]) expect((await call(identity, "chrona_goal_update", { ...edit(foreign.id), dryRun })).error.code).toBe("NOT_FOUND");
    expect((await call(identity, "chrona_goal_read", { goalId: foreign.id, view: "history" })).error.code).toBe("NOT_FOUND");
    await call(identity, "chrona_goal_update", edit(goal.id));
    const audit = await db.event.findFirstOrThrow({ where: { eventType: "goal.management_updated" } });
    await db.event.update({ where: { id: audit.id }, data: { payload: { ...asData(audit.payload), rawProviderPayload: "MUST_NOT_LEAK" } } });
    expect(JSON.stringify(await call(identity, "chrona_goal_read", { goalId: goal.id, view: "history" }))).not.toContain("MUST_NOT_LEAK");
  });

  it("never widens existing assistant/legacy credentials and rechecks reduced or revoked scope on replay", async () => {
    const { identity, goal } = await fixture();
    const legacy = await createManagementClient({ name: "Capture only", publicUrl: "http://localhost:3101", scopes: ["goals:read", "goals:propose"] });
    const capture = await requireManagementClient(legacy.token);
    expect((await call(capture, "chrona_context_read", {})).data.capabilities.goals.editing.canUpdate).toBe(false);
    expect((await call(capture, "chrona_goal_update", edit(goal.id))).error.code).toBe("FORBIDDEN");
    const input = edit(goal.id);
    expect((await call(identity, "chrona_goal_update", input)).ok).toBe(true);
    await db.managementClient.update({ where: { id: identity.id }, data: { scopes: ["goals:read"] } });
    expect((await call(identity, "chrona_goal_update", input)).error.code).toBe("FORBIDDEN");
    await revokeManagementClient(identity.id);
    expect((await call(identity, "chrona_goal_update", input)).error.code).toBe("AUTH_REQUIRED");
    await expect(createManagementClient({ name: "Invalid", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "goals:write"] })).rejects.toThrow("goals:read");
  });

  it("rolls back content, revision, brief version, note, and receipt together", async () => {
    const { identity, goal } = await fixture();
    await expect(withDatabaseTransaction(async () => {
      const result = await call(identity, "chrona_goal_update", { ...edit(goal.id, { brief: { currentFocus: "Rollback" } }), note: { kind: "progress", text: "Rollback note" } });
      expect(result.ok).toBe(true); throw new Error("Enclosing failure");
    })).rejects.toThrow("Enclosing failure");
    expect(await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).toEqual(goal);
    expect(await Promise.all([db.managementCommand.count(), db.event.count(), db.goalBriefRevision.count()])).toEqual([0, 0, 0]);
  });
});
