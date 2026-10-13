import { beforeEach, describe, expect, it } from "bun:test";
import { db, withDatabaseTransaction } from "@/lib/db";
import { resetTestDb, seedWorkspace } from "@chrona/db/test-support";
import { MANAGEMENT_ACCESS_PRESETS, managementTools } from "@chrona/contracts/api";
import { createChronaEngine } from "../../engine";
import { createManagementClient, requireManagementClient } from "./clients";
const engine = createChronaEngine();
const capture = () => ({ requestId: crypto.randomUUID(), newAffair: { title: "Remember trip", summary: "Trip context", goal: "Prepare", keywords: ["trip"] }, note: "Check dates", source: { label: "Chat", excerpt: "Please remember this" }, followUp: { note: "Check booking", dueAt: "2030-01-01T00:00:00Z" } });
const proposal = () => ({ requestId: crypto.randomUUID(), purpose: "Watch for changes", allowedActions: ["read_source", "summarize"] });
async function client(preset: keyof typeof MANAGEMENT_ACCESS_PRESETS = "steward") { return requireManagementClient((await createManagementClient({ name: "Everyday agent", publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS[preset]] })).token); }
const call = async (identity: Awaited<ReturnType<typeof client>>, tool: string, input: unknown): Promise<any> => engine.management.call(identity, tool, input);
beforeEach(async () => {
  // Shared legacy reset helper predates steward tables. It removes owning workspaces first.
  await resetTestDb();
  await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  await db.followUp.deleteMany(); await db.stewardNotification.deleteMany();
  await db.attentionItem.deleteMany(); await db.eventAssessment.deleteMany();
  await db.inboundEvent.deleteMany(); await db.managedTool.deleteMany();
  await db.delegation.deleteMany(); await db.sourceConnection.deleteMany();
  await db.affair.deleteMany(); await db.stewardAudit.deleteMany(); await db.stewardState.deleteMany();
  await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
});
describe("least-privilege steward MCP", () => {
  it("preserves every old profile and denies legacy clients", async () => {
    expect(MANAGEMENT_ACCESS_PRESETS.read).toEqual(["tasks:read"]);
    expect(MANAGEMENT_ACCESS_PRESETS.full).toEqual(["tasks:read", "tasks:write", "schedule:write", "plans:write", "executions:control", "results:accept", "tasks:delete"]);
    expect(MANAGEMENT_ACCESS_PRESETS["assistant-read"]).toEqual(["goals:read"]);
    expect(MANAGEMENT_ACCESS_PRESETS.assistant).toEqual(["goals:read", "goals:propose"]);
    expect(MANAGEMENT_ACCESS_PRESETS["assistant-edit"]).toEqual(["goals:read", "goals:propose", "goals:write"]);
    for (const [name, scopes] of Object.entries(MANAGEMENT_ACCESS_PRESETS)) if (name !== "steward") expect(scopes.some(s => s.startsWith("steward:"))).toBe(false);
    for (const preset of ["read", "full", "assistant-edit"] as const) {
      const identity = await client(preset);
      for (const [tool, input] of [["chrona_steward_today", {}], ["chrona_steward_capture", capture()], ["chrona_steward_delegation_propose", proposal()]] as const) expect((await call(identity, tool, input)).error.code).toBe("FORBIDDEN");
    }
  });
  it("discovers capabilities without granting or provider config", async () => {
    const identity = await client();
    const result = await call(identity, "chrona_context_read", {});
    expect(result.ok).toBe(true);
    expect(result.data.capabilities.steward).toMatchObject({ canRead: true, canPropose: true, granting: false, attentionApproval: false, connectionChanges: false });
    expect(result.data.aiClients).toEqual([]);
    expect(Object.keys(managementTools).filter(n => n.startsWith("chrona_steward_"))).toHaveLength(5);
    for (const name of ["chrona_steward_delegation_grant", "chrona_steward_attention_approve", "chrona_steward_tool_run", "chrona_steward_connection_update"]) expect((await call(identity, name, {})).error.code).toBe("VALIDATION_ERROR");
  });
  it("atomically captures and replays once, rejects changed intent, preserves provenance", async () => {
    const identity = await client(), input = capture();
    const first = await call(identity, "chrona_steward_capture", input);
    expect(first.ok).toBe(true);
    const replay = await call(identity, "chrona_steward_capture", input);
    expect(replay.data).toMatchObject({ commandId: first.data.commandId, replayed: true, result: first.data.result });
    expect((await call(identity, "chrona_steward_capture", { ...input, note: "Different" })).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await db.affair.count()).toBe(1); expect(await db.followUp.count()).toBe(1); expect(await db.attentionItem.count()).toBe(1); expect(await db.managementCommand.count()).toBe(1);
    expect(await db.attentionItem.findFirst()).toMatchObject({ kind: "commitment", dedupeKey: `capture:${input.requestId}`, whyItMatters: "captured by Everyday agent", evidence: [input.source] });
    expect(await db.stewardNotification.count()).toBe(0);
    const duplicate = await call(identity, "chrona_steward_capture", { ...input, requestId: crypto.randomUUID(), newAffair: { ...input.newAffair, title: "  REMEMBER   trip " } });
    expect(duplicate.data.result.possibleDuplicates).toHaveLength(1); expect(await db.affair.count()).toBe(2);
  });
  it("replays delegation proposal and never grants it", async () => {
    const identity = await client(), input = proposal();
    const first = await call(identity, "chrona_steward_delegation_propose", input);
    expect(first.ok).toBe(true);
    expect(first.data.result).toMatchObject({ permissionsGranted: false, delegation: { status: "proposed", grantedAt: null } });
    expect(first.data.result.nextStep).toContain("Delegations");
    expect((await call(identity, "chrona_steward_delegation_propose", input)).data).toMatchObject({ replayed: true, result: first.data.result });
    expect((await call(identity, "chrona_steward_delegation_propose", { ...input, purpose: "Changed" })).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await db.delegation.count()).toBe(1); expect(await db.attentionItem.count()).toBe(1);
    expect(await db.attentionItem.findFirst()).toMatchObject({ kind: "decision", dedupeKey: `delegation-proposal:${first.data.result.delegation.id}` });
    for (const action of ["reply_external", "mark_read_external", "delete_external"]) for (const field of ["allowedActions", "askFirstActions"]) expect((await call(identity, "chrona_steward_delegation_propose", { ...proposal(), [field]: [action] })).error.code).toBe("VALIDATION_ERROR");
  });
  it("dry runs write nothing and transaction failures roll back everything", async () => {
    const identity = await client();
    expect((await call(identity, "chrona_steward_capture", { ...capture(), dryRun: true })).ok).toBe(true);
    expect((await call(identity, "chrona_steward_delegation_propose", { ...proposal(), dryRun: true })).ok).toBe(true);
    await expect(withDatabaseTransaction(async () => { expect((await call(identity, "chrona_steward_capture", capture())).ok).toBe(true); throw new Error("Rollback"); })).rejects.toThrow("Rollback");
    expect(await Promise.all([db.managementCommand.count(), db.affair.count(), db.attentionItem.count(), db.followUp.count(), db.delegation.count(), db.stewardAudit.count()])).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("rejects authority fields and oversized evidence; read-only scope cannot write", async () => {
    const identity = await client();
    for (const extra of [{ workspaceId: "other" }, { status: "active" }, { approved: true }, { permissions: ["grant"] }]) {
      expect((await call(identity, "chrona_steward_capture", { ...capture(), ...extra })).error.code).toBe("VALIDATION_ERROR");
      expect((await call(identity, "chrona_steward_delegation_propose", { ...proposal(), ...extra })).error.code).toBe("VALIDATION_ERROR");
    }
    expect((await call(identity, "chrona_steward_capture", { ...capture(), source: { label: "Chat", excerpt: "x".repeat(1001) } })).error.code).toBe("VALIDATION_ERROR");
    await db.managementClient.update({ where: { id: identity.id }, data: { scopes: ["steward:read"] } });
    expect((await call(identity, "chrona_steward_today", {})).ok).toBe(true);
    expect((await call(identity, "chrona_steward_capture", capture())).error.code).toBe("FORBIDDEN");
    expect((await call(identity, "chrona_steward_delegation_propose", proposal())).error.code).toBe("FORBIDDEN");
    expect(await db.managementCommand.count()).toBe(0);
  });
  it("serializes concurrent retries without extra captures or proposals", async () => {
    const identity = await client();
    for (const [tool, input] of [["chrona_steward_capture", capture()], ["chrona_steward_delegation_propose", proposal()]] as const) {
      const results = await Promise.all(Array.from({ length: 3 }, () => call(identity, tool, input)));
      expect(results.every(r => r.ok)).toBe(true);
      expect(new Set(results.map(r => r.data.commandId)).size).toBe(1);
    }
    expect(await db.affair.count()).toBe(1); expect(await db.followUp.count()).toBe(1);
    expect(await db.delegation.count()).toBe(1); expect(await db.attentionItem.count()).toBe(2);
  });
  it("isolates references and omits connection config and full event bodies", async () => {
    const identity = await client(), other = await seedWorkspace("Other");
    const affair = await db.affair.create({ data: { workspaceId: other.workspaceId, title: "Foreign" } });
    const connection = await db.sourceConnection.create({ data: { workspaceId: other.workspaceId, kind: "local_test", label: "Foreign", config: { secret: "DO_NOT_LEAK" } } });
    expect((await call(identity, "chrona_steward_affair_read", { affairId: affair.id })).error.code).toBe("NOT_FOUND");
    const { newAffair: _new, ...input } = capture();
    expect((await call(identity, "chrona_steward_capture", { ...input, affairId: affair.id })).error.code).toBe("NOT_FOUND");
    expect((await call(identity, "chrona_steward_delegation_propose", { ...proposal(), connectionId: connection.id })).error.code).toBe("NOT_FOUND");
    expect((await call(identity, "chrona_steward_delegation_propose", { ...proposal(), affairId: affair.id })).error.code).toBe("NOT_FOUND");
    const own = (await call(identity, "chrona_steward_capture", capture())).data.result.affairId;
    const ownConnection = await db.sourceConnection.create({ data: { workspaceId: identity.workspaceId, kind: "local_test", label: "Own", config: { secret: "DO_NOT_LEAK" } } });
    await db.inboundEvent.create({ data: { workspaceId: identity.workspaceId, connectionId: ownConnection.id, externalId: "1", affairId: own, title: "Event", author: "Test", body: "x".repeat(1000), occurredAt: new Date(), linkStatus: "confirmed" } });
    const result = await call(identity, "chrona_steward_affair_read", { affairId: own });
    expect(result.ok).toBe(true); expect(result.data.events[0].excerpt).toHaveLength(500);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_LEAK"); expect(result.data.events[0].body).toBeUndefined();
    expect((await call(identity, "chrona_steward_affair_search", {})).data.items).toHaveLength(1);
    for (let i = 0; i < 12; i++) await call(identity, "chrona_steward_capture", { ...input, requestId: crypto.randomUUID() });
    const today = await call(identity, "chrona_steward_today", {});
    expect(today.data.commitments).toHaveLength(10); expect(today.data.upcoming).toHaveLength(10); expect(JSON.stringify(today)).not.toContain("DO_NOT_LEAK");
  });
});
