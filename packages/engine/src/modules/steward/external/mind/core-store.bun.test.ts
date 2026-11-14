import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreMindStore, coreDigest, evidenceId } from "./core-store";
import { CoreMindService } from "./core-service";
import type { CoreAccess, Evidence, IngestBatch, Mutation, Pursuit, Receipt, Scope } from "./core-types";

const owner: CoreAccess = { subject: "owner", role: "owner", scopes: [{}] };
const runtime: CoreAccess = { subject: "mind-adapter", role: "runtime", scopes: [{}] };
const execution: CoreAccess = { ...runtime, execution: { actor: "mind", runRef: "run-1" } };
const resources: Array<{ store: CoreMindStore; directory: string }> = [];
let now = "2026-11-13T12:00:00.000Z";
afterEach(() => { for (const { store, directory } of resources.splice(0)) { store.close(); rmSync(directory, { recursive: true, force: true }); } now = "2026-11-13T12:00:00.000Z"; });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "mind-core-test-")), store = new CoreMindStore(directory);
  resources.push({ store, directory });
  return { store, directory, service: new CoreMindService(store, { now: () => now }) };
}
/** Unit-fixture trust boundary: setup stands in for an independent admission adapter. */
function unitTrustedAdmission<T extends Mutation>(operation: string, input: T, access: CoreAccess): CoreAccess {
  return { ...access, semanticAdmission: { digest: coreDigest({ operation, input }) } };
}
function value<T>(receipt: Receipt<T>): T { expect(receipt.outcome).toBe("applied"); return receipt.value!; }
function event(id: string, scope: Scope = {}, actor: Evidence["actor"] = "user", revision = 1): IngestBatch["events"][number] {
  return { id, eventId: id, cursor: id, object: { kind: "message", id, revision }, kind: "message", scope,
    actor, origin: { rootId: id }, occurredAt: now, receivedAt: now, scopeRevision: 1,
    content: { text: `sent ${id}`, truncated: false } };
}
function ingest(service: CoreMindService, events: IngestBatch["events"], epoch = "epoch-1", identityContinuityVerified = false) {
  const checkpoint = service.store.read().checkpoints.find(c => c.id === "chat");
  return service.ingest({ sourceIdentity: "chat", epoch, expectedCheckpointRevision: checkpoint?.revision ?? 0,
    nextCursor: events.at(-1)?.cursor ?? "empty", scopeRevision: 1, capturedAt: now, coverage: { complete: true }, events, identityContinuityVerified }, runtime);
}
function createPursuit(service: CoreMindService, key = "goal", scope: Scope = {}): Pursuit {
  return value(service.pursue({ actionKey: key, expectedVisibilityRevision: service.store.read().visibilityRevision,
    expectedRevision: 0, semanticKey: key, goal: "finish the useful result", completionCriteria: ["artifact opens and solves request"],
    scope, reason: "explicit-goal", evidenceRefs: [] }, owner));
}
function claim(service: CoreMindService, p: Pursuit) {
  return value(service.claim({ actionKey: `claim-${p.id}`, expectedVisibilityRevision: service.store.read().visibilityRevision, pursuitId: p.id, expectedRevision: p.revision }, execution));
}

describe("Mind private core", () => {
  test("fresh browsing and source ingestion never invent understandings or pursuits; private durable SQLite and rollback", () => {
    const { service, store, directory } = setup();
    expect(service.overview({}, owner).items).toEqual([]);
    expect(service.context({ scope: {} }, owner).unknowns).toContain("no_source_coverage");
    ingest(service, [event("casual-question"), event("assistant-suggestion", {}, "assistant")]);
    expect(service.overview({}, owner).items).toEqual([]);
    expect(store.read().evidence).toHaveLength(2);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(store.path).subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(() => store.update(tx => { tx.delete("evidence", store.read().evidence[0]!.id); })).toThrow("Nested");
    expect(store.read().evidence).toHaveLength(2);
    const second = new CoreMindStore(directory);
    try { expect(second.read().evidence).toHaveLength(2); } finally { second.close(); }
  });

  test("source batch checkpoint is atomic, exact retry idempotent, altered stable event rejected", () => {
    const { service, store } = setup();
    const input: IngestBatch = { sourceIdentity: "chat", epoch: "one", expectedCheckpointRevision: 0, nextCursor: "two", scopeRevision: 1,
      capturedAt: now, coverage: { complete: true }, events: [event("one"), event("two")] };
    expect(service.ingest(input, runtime)).toEqual(service.ingest(input, runtime));
    expect(store.read().evidence).toHaveLength(2);
    expect(() => service.ingest({ ...input, expectedCheckpointRevision: 1, events: [event("new"), { ...event("one"), content: { text: "tampered", truncated: false } }] }, runtime)).toThrow("identity reused");
    expect(store.read().evidence).toHaveLength(2);
    expect(store.read().checkpoints[0]!.revision).toBe(1);
  });

  test("explicit user facts, local exceptions and inferred candidates stay scoped; caller payload cannot authorize", () => {
    const { service, store } = setup();
    ingest(service, [event("global"), event("local", { sessionId: "s1" }), event("suggestion", {}, "assistant")]);
    const remember = (id: string, scope: Scope, explicitness: "explicit" | "inferred", key: string) => {
      const input = { actionKey: key, expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const, value: key, scope, explicitness,
        supportingRefs: [evidenceId("chat", "epoch-1", id)] };
      return service.remember(input, unitTrustedAdmission("remember", input, runtime));
    };
    const global = value(remember("global", {}, "explicit", "local by default"));
    const local = value(remember("local", { sessionId: "s1" }, "explicit", "cloud this time"));
    expect(value(remember("suggestion", {}, "inferred", "possibly cloud" )).status).toBe("candidate");
    expect(() => remember("suggestion", {}, "explicit", "assistant is user" )).toThrow("Explicit user evidence");
    expect(() => remember("local", {}, "explicit", "overgeneralized" )).toThrow("Explicit user evidence");
    const result = service.context({ scope: { sessionId: "s1" } }, owner);
    expect(result.understandings[0]!.id).toBe(local.id);
    expect(result.understandings.some(u => u.id === global.id)).toBe(true);
    expect(service.context({ scope: { sessionId: "s2" } }, owner).understandings.some(u => u.id === local.id)).toBe(false);
    const app: CoreAccess = { subject: "chat", role: "application", scopes: [{ sessionId: "s2" }] };
    expect(() => service.context({ scope: { sessionId: "s1" }, caller: "owner" } as never, app)).toThrow("scope");
    expect(() => service.detail({ kind: "understanding", id: local.id }, app)).toThrow("scope");
    expect(() => service.settings({ actionKey: "fake-owner", expectedRevision: 0, expectedVisibilityRevision: 0, patch: { enabled: false } }, app)).toThrow("owner");
    expect(store.read().pursuits).toHaveLength(0);
  });

  test("non-owner remember rejects a missing semantic admission proof", () => {
    const { service } = setup();
    const input = { actionKey: "missing-proof", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const,
      value: "a preference", scope: {}, explicitness: "explicit" as const, supportingRefs: [] };
    expect(() => service.remember(input, runtime)).toThrow("grounded independent semantic admission");
  });

  test("semantic admission rejects a proof for the wrong operation or payload", () => {
    const { service } = setup();
    const input = { actionKey: "exact-proof", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const,
      value: "the original preference", scope: {}, explicitness: "explicit" as const, supportingRefs: [] };
    const wrongOperation = { ...runtime, semanticAdmission: { digest: coreDigest({ operation: "pursue", input }) } };
    const alteredInput = { ...input, value: "a changed preference" };
    const proofForOriginal = { ...runtime, semanticAdmission: { digest: coreDigest({ operation: "remember", input }) } };
    expect(() => service.remember(input, wrongOperation)).toThrow("grounded independent semantic admission");
    expect(() => service.remember(alteredInput, proofForOriginal)).toThrow("grounded independent semantic admission");
  });

  test("owner direct mutation still works without semantic admission", () => {
    const { service } = setup();
    const input = { actionKey: "owner-direct", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const,
      value: "owner supplied preference", scope: {}, explicitness: "explicit" as const, supportingRefs: [] };
    expect(value(service.remember(input, owner)).value).toBe("owner supplied preference");
  });

  test("same actionKey same parameters gives original receipt; conflict on changed parameters and stale versions", () => {
    const { service } = setup();
    const input = { actionKey: "once", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const, value: "save locally", scope: {}, explicitness: "explicit" as const, supportingRefs: [] };
    const first = service.remember(input, owner);
    expect(service.remember(input, owner)).toEqual(first);
    expect(() => service.remember({ ...input, value: "save remotely" }, owner)).toThrow("different parameters");
    const u = value(first);
    expect(() => service.remember({ ...input, id: u.id, actionKey: "stale" }, owner)).toThrow("Version mismatch");
    expect(service.store.read().understandings).toHaveLength(1);
  });

  test("concurrent discovery shares one pursuit and responsibility CAS never expires into a second actor", () => {
    const { service, directory } = setup();
    const p = createPursuit(service);
    const duplicate = createPursuit(service);
    expect(duplicate.id).toBe(p.id);
    const current = claim(service, p), otherStore = new CoreMindStore(directory), other = new CoreMindService(otherStore, { now: () => now });
    try {
      expect(() => other.claim({ actionKey: "other-claim", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: p.revision }, { ...execution, execution: { actor: "chat", runRef: "run-2" } })).toThrow("Version mismatch");
      now = "2027-11-13T12:00:00.000Z";
      expect(() => other.claim({ actionKey: "expired-claim", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: current.revision }, { ...execution, execution: { actor: "chat", runRef: "run-2" } })).toThrow("occupied");
      expect(() => other.release({ actionKey: "unsafe-release", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: current.revision, runRef: "run-1", executionStopped: true, effectsReconciled: false }, runtime)).toThrow("reconciled");
    } finally { otherStore.close(); }
    expect(service.store.read().pursuits).toHaveLength(1);
  });

  test("correction fences old effects and old verified candidate cannot overwrite new goal; stop remains unconfirmed", () => {
    const { service } = setup(); const p = claim(service, createPursuit(service));
    const c = value(service.progress({ actionKey: "report", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: p.revision,
      summary: "old goal is done", artifactRefs: ["artifact:one"], originalReceiptRef: "effect:one", evidenceRefs: p.evidenceRefs, desiredStatus: "done" }, execution));
    expect(service.detail({ kind: "pursuit", id: p.id }, owner).status).toBe("active");
    const corrected = value(service.control({ actionKey: "correct", expectedVisibilityRevision: 0, kind: "pursuit", id: p.id, expectedRevision: p.revision,
      operation: "correct", value: "new direction", evidenceRefs: [] }, owner));
    expect((corrected as Pursuit).currentActor?.stopRequested).toBe(true);
    expect(() => service.guardAction({ actionKey: "old-effect", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: p.revision, target: "files.write", arguments: {} }, execution)).toThrow("Version mismatch");
    const result = value(service.applyProgress({ actionKey: "verify-old", expectedVisibilityRevision: 0, expectedRevision: p.revision,
      candidateId: c.id, verified: { candidateReceipt: c.receipt, runRef: c.runRef, originalReceiptRef: c.originalReceiptRef, artifactRefs: c.artifactRefs, method: "persisted result + artifact opened", criteriaSatisfied: true, executionTerminal: true } }, runtime));
    expect(result.applied).toBe(false);
    expect(result.pursuit.goal).toBe("new direction");
    expect(result.pursuit.status).not.toBe("done");
    expect(result.pursuit.currentActor).toBeDefined();
  });

  test("progress candidate needs trusted verifier with receipt and real completion checks, finished alone is insufficient", () => {
    const { service } = setup(), p = claim(service, createPursuit(service));
    const c = value(service.progress({ actionKey: "candidate", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: p.revision,
      summary: "prepared", artifactRefs: ["artifact"], originalReceiptRef: "original", evidenceRefs: p.evidenceRefs, desiredStatus: "done" }, execution));
    const input = { actionKey: "verify", expectedVisibilityRevision: 0, expectedRevision: p.revision, candidateId: c.id,
      verified: { candidateReceipt: c.receipt, runRef: c.runRef, originalReceiptRef: "original", artifactRefs: ["artifact"], method: "actual artifact inspection", criteriaSatisfied: false, executionTerminal: true } };
    expect(() => service.applyProgress(input, owner)).toThrow("runtime");
    expect(() => service.applyProgress(input, runtime)).toThrow("Finished run alone");
    expect(() => service.applyProgress({ ...input, verified: { ...input.verified, candidateReceipt: "forged", criteriaSatisfied: true } }, runtime)).toThrow("do not match");
    const result = value(service.applyProgress({ ...input, verified: { ...input.verified, criteriaSatisfied: true } }, runtime));
    expect(result.pursuit.status).toBe("done");
    expect(result.pursuit.artifactRefs).toEqual(["artifact"]);
  });

  test("pause persists across ordinary events; no resume until old execution and effects are reconciled", () => {
    const { service } = setup(), p = claim(service, createPursuit(service));
    const paused = value(service.control({ actionKey: "pause", expectedVisibilityRevision: 0, kind: "pursuit", id: p.id, expectedRevision: p.revision, operation: "pause" }, owner)) as Pursuit;
    ingest(service, [event("new casual message")]);
    expect(service.detail({ kind: "pursuit", id: p.id }, owner).paused).toBe(true);
    expect(() => service.control({ actionKey: "resume", expectedVisibilityRevision: 0, kind: "pursuit", id: p.id, expectedRevision: paused.revision, operation: "resume" }, owner)).toThrow("reconciled");
    const released = value(service.release({ actionKey: "release", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: paused.revision, runRef: "run-1", executionStopped: true, effectsReconciled: true }, runtime));
    const resumed = value(service.control({ actionKey: "resume", expectedVisibilityRevision: 0, kind: "pursuit", id: p.id, expectedRevision: released.revision, operation: "resume" }, owner)) as Pursuit;
    expect(resumed.paused).toBe(false);
  });

  test("selective forget removes copied prose, stops dependent work, blocks replay across epoch and preserves independent scope", () => {
    const { service, store, directory } = setup();
    ingest(service, [event("secret", { sessionId: "s1" }), event("independent", { sessionId: "s2" })]);
    const refs = [evidenceId("chat", "epoch-1", "secret")];
    const input = { actionKey: "secret-memory", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const, value: "very private preference", scope: { sessionId: "s1" }, explicitness: "explicit" as const, supportingRefs: refs };
    const u = value(service.remember(input, unitTrustedAdmission("remember", input, runtime)));
    const pursuitInput = { actionKey: "secret-goal", expectedVisibilityRevision: 0, expectedRevision: 0, semanticKey: "very private semantic identity", goal: "very private goal",
      completionCriteria: ["private result"], scope: { sessionId: "s1" }, reason: "explicit-goal" as const, evidenceRefs: refs, understandingRefs: [u.id] };
    const p = value(service.pursue(pursuitInput, unitTrustedAdmission("pursue", pursuitInput, runtime)));
    const active = claim(service, p);
    value(service.progress({ actionKey: "secret-result", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: active.revision,
      summary: "private result candidate", artifactRefs: [], originalReceiptRef: "effect-ref", evidenceRefs: refs, desiredStatus: "done" }, execution));
    const forgotten = value(service.forget({ actionKey: "forget-s1", expectedVisibilityRevision: 0, target: { kind: "session", sessionId: "s1" } }, owner));
    expect(forgotten.visibilityRevision).toBe(1);
    expect(service.remember(input, unitTrustedAdmission("remember", input, runtime)).outcome).toBe("forgotten");
    expect(service.detail({ kind: "pursuit", id: p.id }, owner).currentActor?.stopRequested).toBe(true);
    ingest(service, [event("secret", { sessionId: "s1" }), event("independent-new", { sessionId: "s2" })], "epoch-2", true);
    expect(store.read().evidence.some(e => e.epoch === "epoch-2" && e.scope.sessionId === "s1")).toBe(false);
    expect(store.read().evidence.some(e => e.epoch === "epoch-2" && e.scope.sessionId === "s2")).toBe(true);
    expect(store.read().candidates).toHaveLength(0);
    expect(JSON.stringify(store.read())).not.toContain("very private");
    expect(readFileSync(store.path).includes(Buffer.from("very private"))).toBe(false);
    const second = new CoreMindStore(directory);
    try { expect(second.read().retractions.length).toBeGreaterThan(0); } finally { second.close(); }
    expect(service.context({ scope: { sessionId: "s1" } }, owner).understandings).toHaveLength(0);
  });

  test("source edits invalidate derived facts without permanently blocking later revisions; old out-of-order text stays withdrawn", () => {
    const { service, store } = setup();
    ingest(service, [event("editable")]);
    const old = evidenceId("chat", "epoch-1", "editable");
    const oldInput = { actionKey: "old-memory", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const, value: "old text interpretation", scope: {}, explicitness: "explicit" as const, supportingRefs: [old] };
    value(service.remember(oldInput, unitTrustedAdmission("remember", oldInput, runtime)));
    ingest(service, [{ ...event("edit-2", {}, "user", 2), object: { kind: "message", id: "editable", revision: 2 } }]);
    ingest(service, [{ ...event("edit-3", {}, "user", 3), object: { kind: "message", id: "editable", revision: 3 } }]);
    expect(store.read().evidence.filter(e => !e.retractedAt)).toHaveLength(1);
    expect(store.read().evidence.find(e => !e.retractedAt)!.object.revision).toBe(3);
    expect(service.context({ scope: {} }, owner).understandings).toHaveLength(0);
  });

  test("independent repetition excludes assistant suggestions and self reports; explicit ongoing goal starts immediately", () => {
    const { service, store } = setup();
    ingest(service, [event("u1"), event("u2"), { ...event("self", {}, "assistant"), origin: { rootId: "u3", pursuitId: "old-mind-work" } }]);
    const input = { actionKey: "improvement", expectedVisibilityRevision: 0, expectedRevision: 0, semanticKey: "automate", goal: "automate sorting", completionCriteria: ["works"], scope: {}, reason: "improvement" as const,
      evidenceRefs: ["u1", "u2", "self"].map(id => evidenceId("chat", "epoch-1", id)) };
    expect(() => service.pursue(input, unitTrustedAdmission("pursue", input, runtime))).toThrow("three independent");
    ingest(service, [event("u3")]);
    const improvedInput = { ...input, evidenceRefs: ["u1", "u2", "u3"].map(id => evidenceId("chat", "epoch-1", id)) };
    const result = value(service.pursue(improvedInput, unitTrustedAdmission("pursue", improvedInput, runtime)));
    expect(result.status).toBe("candidate");
    createPursuit(service, "once-explicit");
    expect(store.read().pursuits).toHaveLength(2);
  });

  test("retention expires snippets and uncertainty but retains live goals and usable artifacts beyond 256 operations", () => {
    const { service, store } = setup();
    const p = createPursuit(service);
    for (let i = 0; i < 300; i++) value(service.feedback({ actionKey: `feedback-${i}`, expectedVisibilityRevision: 0, targetKind: "pursuit", targetId: p.id,
      expectedRevision: p.revision, value: "useful", scope: {} }, owner));
    ingest(service, [event("old"), { ...event("diagnostic"), diagnostic: true }]);
    const longTermInput = { actionKey: "long-term", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const, value: "keep result", scope: {}, explicitness: "explicit" as const, supportingRefs: [evidenceId("chat", "epoch-1", "old")] };
    const u = value(service.remember(longTermInput, unitTrustedAdmission("remember", longTermInput, runtime)));
    store.update(tx => { const work = tx.get("pursuit", p.id)!; work.artifactRefs = ["permanent-result"]; tx.put("pursuit", work); });
    now = "2026-11-21T12:00:00.000Z";
    expect(service.maintain(runtime).expired).toBe(1);
    now = "2026-12-15T12:00:00.000Z";
    expect(service.maintain(runtime).expired).toBeGreaterThan(0);
    expect(service.detail({ kind: "understanding", id: u.id }, owner).status).toBe("needs-review");
    expect(service.detail({ kind: "pursuit", id: p.id }, owner).artifactRefs).toEqual(["permanent-result"]);
    expect(store.read().feedback).toHaveLength(300);
    expect(value(service.feedback({ actionKey: "after-300", expectedVisibilityRevision: 0, targetKind: "pursuit", targetId: p.id, expectedRevision: p.revision, value: "useful", scope: {} }, owner)).value).toBe("useful");
  }, 30000);

  test("cached mutation results are reauthorized after caller scope narrows, including scopeless progress receipts", () => {
    const { service } = setup();
    const scope = { sessionId: "s1" }, access = { ...owner, subject: "same-caller" };
    const input = { actionKey: "memory", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const,
      value: "session private", scope, explicitness: "explicit" as const, supportingRefs: [] };
    service.remember(input, access);
    expect(() => service.remember(input, { ...access, scopes: [{ sessionId: "s2" }] })).toThrow("scope");
    const p = claim(service, createPursuit(service, "scoped", scope));
    const progress = { actionKey: "scoped-progress", expectedVisibilityRevision: 0, expectedRevision: p.revision,
      pursuitId: p.id, summary: "private result", artifactRefs: [], originalReceiptRef: "source", evidenceRefs: p.evidenceRefs, desiredStatus: "waiting" as const };
    service.progress(progress, execution);
    expect(() => service.progress(progress, { ...execution, scopes: [{ sessionId: "s2" }] })).toThrow("scope");
  });

  test("understanding correction invalidates its pursuit, pending progress and replayed effect dispatch", () => {
    const { service } = setup();
    const u = value(service.remember({ actionKey: "remember-direction", expectedVisibilityRevision: 0, expectedRevision: 0,
      kind: "constraint", value: "local only", scope: {}, explicitness: "explicit", supportingRefs: [] }, owner));
    const p = claim(service, value(service.pursue({ actionKey: "dependent", expectedVisibilityRevision: 0, expectedRevision: 0,
      semanticKey: "dependent", goal: "prepare result", completionCriteria: ["honors latest constraint"], scope: {}, reason: "explicit-goal",
      evidenceRefs: [], understandingRefs: [u.id] }, owner)));
    const effect = { actionKey: "before-correction", expectedVisibilityRevision: 0, expectedRevision: p.revision, pursuitId: p.id,
      target: "document", arguments: { title: "result" } };
    service.guardAction(effect, execution);
    const c = value(service.progress({ actionKey: "candidate-before-correction", expectedVisibilityRevision: 0, expectedRevision: p.revision,
      pursuitId: p.id, summary: "old direction result", artifactRefs: [], originalReceiptRef: "effect", evidenceRefs: p.evidenceRefs, desiredStatus: "done" }, execution));
    service.control({ actionKey: "correct-direction", expectedVisibilityRevision: 0, expectedRevision: u.revision,
      kind: "understanding", id: u.id, operation: "correct", value: "local and redacted" }, owner);
    const changed = service.detail({ kind: "pursuit", id: p.id }, owner);
    expect(changed.revision).toBeGreaterThan(p.revision);
    expect(changed.currentActor?.stopRequested).toBe(true);
    expect(() => service.guardAction(effect, execution)).toThrow("Version mismatch");
    const result = value(service.applyProgress({ actionKey: "verify-old-direction", expectedVisibilityRevision: 0, expectedRevision: changed.revision,
      candidateId: c.id, verified: { candidateReceipt: c.receipt, runRef: c.runRef, originalReceiptRef: "effect", artifactRefs: [],
        method: "inspected original tool receipt", criteriaSatisfied: true, executionTerminal: true } }, runtime));
    expect(result.applied).toBe(false);
    expect(result.pursuit.status).toBe("waiting");
  });

  test("new goal criteria revoke a previously verified done result", () => {
    const { service } = setup(), p = claim(service, createPursuit(service));
    const c = value(service.progress({ actionKey: "finish", expectedVisibilityRevision: 0, expectedRevision: p.revision, pursuitId: p.id,
      summary: "verified original result", artifactRefs: [], originalReceiptRef: "effect", evidenceRefs: p.evidenceRefs, desiredStatus: "done" }, execution));
    const done = value(service.applyProgress({ actionKey: "verify-done", expectedVisibilityRevision: 0, expectedRevision: p.revision, candidateId: c.id,
      verified: { candidateReceipt: c.receipt, runRef: c.runRef, originalReceiptRef: "effect", artifactRefs: [], method: "checked result",
        criteriaSatisfied: true, executionTerminal: true } }, runtime)).pursuit;
    const updated = value(service.pursue({ actionKey: "new-criteria", expectedVisibilityRevision: 0, expectedRevision: done.revision, id: done.id,
      semanticKey: "goal", goal: "also support new workflow", completionCriteria: ["new workflow actually works"], scope: {}, reason: "explicit-goal", evidenceRefs: [] }, owner));
    expect(updated.status).toBe("waiting"); expect(updated.verification).toBeUndefined();
    expect(updated.currentActor?.stopRequested).toBe(true);
  });

  test("epoch import blocks unknown object mapping; stable identity proof still honors existing object tombstones", () => {
    const { service, store } = setup();
    ingest(service, [event("removed")]);
    service.forget({ actionKey: "forget-object", expectedVisibilityRevision: 0,
      target: { kind: "object", sourceIdentity: "chat", objectKind: "message", objectId: "removed" } }, owner);
    expect(() => ingest(service, [event("remapped")], "epoch-2")).toThrow("verify stable");
    expect(store.read().checkpoints[0]!.epoch).toBe("epoch-1");
    ingest(service, [event("removed"), event("independent-new")], "epoch-2", true);
    expect(store.read().evidence.some(e => e.epoch === "epoch-2" && e.object.id === "removed")).toBe(false);
    expect(store.read().evidence.some(e => e.epoch === "epoch-2" && e.object.id === "independent-new")).toBe(true);
  });

  test("forgetting an understanding blocks paraphrased reconstruction from the same historical source across epochs", () => {
    const { service, store } = setup();
    ingest(service, [event("history")]);
    const input = { actionKey: "historical-memory", expectedVisibilityRevision: 0, expectedRevision: 0, kind: "preference" as const,
      value: "do not retain this preference", scope: {}, explicitness: "explicit" as const, supportingRefs: [evidenceId("chat", "epoch-1", "history")] };
    const u = value(service.remember(input, unitTrustedAdmission("remember", input, runtime)));
    service.forget({ actionKey: "forget-memory", expectedVisibilityRevision: 0, target: { kind: "understanding", id: u.id } }, owner);
    const paraphraseInput = { ...input, actionKey: "paraphrase", expectedVisibilityRevision: 1, value: "same preference restated" };
    expect(() => service.remember(paraphraseInput, unitTrustedAdmission("remember", paraphraseInput, runtime))).toThrow("Forgotten understanding");
    ingest(service, [event("history")], "epoch-2", true);
    // Epoch transitions deliberately hold coverage incomplete until a consistent rebuild commits.
    ingest(service, [], "epoch-2", true);
    const epochParaphraseInput = { ...input, actionKey: "epoch-paraphrase", expectedVisibilityRevision: 1,
      supportingRefs: [evidenceId("chat", "epoch-2", "history")] };
    expect(() => service.remember(epochParaphraseInput, unitTrustedAdmission("remember", epochParaphraseInput, runtime))).toThrow("Forgotten understanding");
    expect(store.read().understandings.filter(item => item.status === "active")).toHaveLength(0);
    const fresh = value(service.remember({ ...input, actionKey: "new-owner-request", expectedVisibilityRevision: 1, supportingRefs: [] }, owner));
    expect(fresh.status).toBe("active");
  });

  test("effect intent parameters stay fixed through response loss, unknown remains unknown and restore guard fences ingest", () => {
    const { service } = setup(), p = claim(service, createPursuit(service));
    const input = { actionKey: "effect-once", expectedVisibilityRevision: 0, pursuitId: p.id, expectedRevision: p.revision, target: "test.write", arguments: { text: "a" } };
    expect(service.guardAction(input, execution)).toEqual(service.guardAction(input, execution));
    expect(() => service.guardAction({ ...input, arguments: { text: "b" } }, execution)).toThrow("different parameters");
    const outcome = value(service.recordAction({ actionKey: "record-unknown", effectActionKey: input.actionKey, expectedVisibilityRevision: 0, originalReceiptRef: "original-effect", outcome: "unknown" }, runtime));
    expect(outcome.outcome).toBe("unknown");
    service.setRestoreBlocked(true, runtime);
    expect(() => ingest(service, [event("new")])).toThrow("Retraction ledger");
    expect(() => service.guardAction({ ...input, actionKey: "new-effect", expectedVisibilityRevision: 1 }, execution)).toThrow("Retraction ledger");
    expect(service.context({ scope: {} }, owner).unknowns).toContain("restore_retraction_ledger_unverified");
  });
});
