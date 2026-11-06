import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workStartSchema, workRequestSchema, workViewSchema, type WorkLeafStart, type WorkView, type ExecutionView, type ExecutionPlacementView } from "./contract.js";
import { handleWorkCommand, reconcileWorks, groupPhase, workPhase } from "./work-v2";
import { cleanupWorkspace, installWorkspace } from "./workspaces";
import { readRegistry, saveRegistry } from "./work-v2-storage";
import { readCodingWork, type CodingContext } from "./storage";
import { dependencyGoal } from "./dependency-context";

const baseline = { kind: "commit" as const, digest: "a".repeat(40) };
function leaf(workId: string, dependsOnWorkIds: string[] = []): WorkLeafStart {
  return { kind: "execution", workId, commandKey: `start-${workId}`, goal: `修改 ${workId}`, placement: { executorId: "server", projectRef: "repo", mappingRevision: 1 }, workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: new Date(Date.now() + 60_000).toISOString(), budget: { timeoutMs: 1000, maxToolCalls: 1 }, dependsOnWorkIds };
}
const a = leaf("a"), b = leaf("b", ["a"]);
const input = workStartSchema.parse({ kind: "group", workId: "parent", commandKey: "start-parent", goal: "两个相关修改", children: [a, b] });
assert.throws(() => workStartSchema.parse({ ...input, children: [a, { ...b, workId: "a" }] }));
assert.throws(() => workStartSchema.parse({ ...input, children: [{ ...a, dependsOnWorkIds: ["b"] }, b] }));
assert.throws(() => workStartSchema.parse({ ...a, parentWorkId: "parent" }));
assert.throws(() => workStartSchema.parse({ ...input, children: [a, { ...b, dependsOnWorkIds: ["outside"] }] }));
for (const [status, stopped, cancel, phase] of [
  ["completed", false, false, "unknown"], ["completed", true, false, "completed"], ["cancelled", false, true, "stopping"], ["unknown", false, false, "unknown"], ["failed", true, false, "failed"],
] as const) assert.equal(workPhase({ workId: "a", sessionId: "s", runId: "r", attemptId: "t", projectRef: "repo", status, stopConfirmed: stopped, cancelRequested: cancel }), phase);
const dir = await mkdtemp(join(tmpdir(), "coding-v2-test-"));
const executions = new Map<string, ExecutionView>();
const starts: string[] = [], cancelled: string[] = [];
const dispatchInputs = new Map<string, Record<string, unknown>>();
let loseReceipt = true, missingFinal = false;
function placement(workId: string): ExecutionPlacementView {
  return { ...executions.get(workId)!, placement: a.placement, workspace: { workspaceRef: `tree-${workId}`, mode: "independent_worktree", baseline, state: "ready", sourceReceipt: null, retained: true }, queueExpiresAt: String(dispatchInputs.get(workId)!.queueExpiresAt), online: true };
}
const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
  const id = String(args.workId);
  if (target === "executions.lookup-start") {
    const found = [...executions.values()].find(view => `start-${view.workId}` === args.commandKey);
    if (!found) throw Object.assign(new Error("missing"), { code: "not_found" });
    return { ...found } as T;
  }
  if (target === "executions.start-v2") {
    assert.equal(Object.hasOwn(args, "parentWorkId"), false); assert.equal(Object.hasOwn(args, "dependsOnWorkIds"), false);
    starts.push(id);
    dispatchInputs.set(id, structuredClone(args));
    const execution: ExecutionView = { workId: id, sessionId: `s-${id}`, runId: `r-${id}`, attemptId: `t-${id}`, projectRef: "repo", status: "queued", cancelRequested: false, stopConfirmed: false };
    executions.set(id, execution);
    if (loseReceipt) { loseReceipt = false; throw Object.assign(new Error("lost receipt"), { code: "unavailable" }); }
    return { execution: { ...execution }, placement: placement(id) } as T;
  }
  const view = executions.get(id);
  if (!view) throw Object.assign(new Error("missing"), { code: "not_found" });
  if (target === "executions.get") return { ...view } as T;
  if (target === "executions.placement") return placement(id) as T;
  if (target === "executions.cancel") { cancelled.push(id); view.cancelRequested = true; return { ...view } as T; }
  if (target === "executions.snapshot") return { ...view, highWatermark: 1, finalMessage: missingFinal ? null : { messageId: "m", text: `${id} 修改完成，未运行测试`, truncated: false }, questions: [], missing: false, expiresAt: new Date(Date.now() + 60_000).toISOString() } as T;
  if (target === "executions.result-source") return { workId: id, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, baseline } as T;
  throw new Error(`Unexpected target ${target}`);
} };
try {
  await assert.rejects(handleWorkCommand(context, { op: "start", input }), { code: "unavailable" });
  const persisted = await readRegistry(context);
  assert.deepEqual(persisted.records[0]!.views.map(view => view.workId), ["parent", "a", "b"]);
  assert.deepEqual(persisted.records[0]!.dispatching, ["a"]);
  const parent = await handleWorkCommand({ ...context }, { op: "lookup_start", commandKey: "start-parent" }) as WorkView;
  assert.equal(parent.execution, null); assert.equal(parent.workspace, null); assert.equal(parent.phase, "waiting_dependency");
  assert.deepEqual(starts, ["a"]);
  await assert.rejects(handleWorkCommand(context, { op: "start", input: { ...input, goal: "different" } }), { code: "conflict" });
  for (const status of ["unknown", "failed"] as const) {
    executions.get("a")!.status = status;
    await reconcileWorks(context, "parent");
    assert.deepEqual(starts, ["a"], `${status} predecessor must block`);
  }
  executions.get("a")!.status = "completed";
  await reconcileWorks(context, "parent");
  assert.deepEqual(starts, ["a"], "completed without real stop must block");
  executions.get("a")!.stopConfirmed = true; missingFinal = true;
  await reconcileWorks(context, "parent");
  assert.deepEqual(starts, ["a"], "missing immutable final must block");
  missingFinal = false;
  loseReceipt = true;
  await assert.rejects(reconcileWorks(context, "parent"), { code: "unavailable" });
  const lostDispatch = structuredClone(dispatchInputs.get("b"));
  await reconcileWorks(context, "parent");
  assert.deepEqual(dispatchInputs.get("b"), lostDispatch, "lost dependent ACK resolves original start without changing input");
  assert.deepEqual(starts, ["a", "b"]);
  const child = await handleWorkCommand(context, { op: "get", workId: "b" }) as WorkView;
  assert.ok(workViewSchema.safeParse(child).success);
  assert.equal(child.dependencyResults[0]!.workId, "a");
  assert.equal(child.dependencyResults[0]!.attemptId, "t-a");
  assert.equal(child.workspace!.retained, true);
  const goal = String(dispatchInputs.get("b")!.goal);
  assert.ok(goal.startsWith(b.goal));
  assert.ok(goal.includes("a 修改完成"));
  assert.ok(goal.includes(child.dependencyResults[0]!.artifactRef));
  assert.ok(goal.includes('"attemptId":"t-a"'));
  assert.equal((await readCodingWork(context, "b")).start.goal, b.goal, "legacy work identity keeps original user goal");
  assert.equal(child.goal, b.goal);
  const sameInstant = structuredClone(child);
  sameInstant.queueExpiresAt = child.queueExpiresAt!.replace(/\.\d{3}Z$/, "Z");
  const normalizedPlacement = placement("b");
  normalizedPlacement.queueExpiresAt = new Date(sameInstant.queueExpiresAt!).toISOString();
  installWorkspace(sameInstant, normalizedPlacement);
  assert.throws(() => installWorkspace(sameInstant, { ...normalizedPlacement, queueExpiresAt: new Date(Date.parse(sameInstant.queueExpiresAt!) + 1000).toISOString() }), { code: "conflict" });
  assert.throws(() => installWorkspace({ ...sameInstant, queueExpiresAt: "invalid" }, normalizedPlacement), { code: "conflict" });
  assert.throws(() => installWorkspace(structuredClone(child), { ...placement("b"), workspace: { ...placement("b").workspace, workspaceRef: "different-tree" } }), { code: "conflict" });
  await assert.rejects(cleanupWorkspace({ ...context, call: async <T>() => ({ workId: "other", workspaceRef: "tree-b", state: "removed", reason: "", previewDigest: null }) as T }, child, { action: "preview", workId: "b", commandKey: "preview-b" }), { code: "conflict" });
  const artifact = child.dependencyResults[0]!.artifactRef;
  assert.ok((await readFile(join(dir, "artifacts", `${artifact}.json`), "utf8")).includes("修改完成"));
  await assert.rejects(handleWorkCommand(context, { op: "cancel", workId: "b", commandKey: "wrong-target" }), { code: "conflict" });
  const stopping = await handleWorkCommand(context, { op: "cancel", workId: "parent", commandKey: "cancel-parent" }) as WorkView;
  assert.equal(stopping.phase, "stopping"); assert.ok(cancelled.includes("b"));
  assert.equal((await readRegistry(context)).records[0]!.views[0]!.cancelRequested, true);
  executions.get("b")!.status = "cancelled"; executions.get("b")!.stopConfirmed = true;
  await reconcileWorks({ ...context }, "parent");
  const stopped = await handleWorkCommand(context, { op: "get", workId: "parent" }) as WorkView;
  assert.equal(stopped.phase, "cancelled");
  const results = await handleWorkCommand(context, { op: "results", workId: "parent" }) as { results: { workId: string }[] };
  assert.deepEqual(results.results.map(result => result.workId), ["a", "b"]);
  assert.equal(groupPhase([{ ...child, execution: null, phase: "unknown" }], true), "stopping", "lost admission receipt does not prove stopped");
  const envelope = workRequestSchema.parse({ v: "chrona.execution.v2", requestId: "test", command: { op: "get", workId: "parent" } });
  assert.equal(envelope.command.op, "get");
  assert.deepEqual(starts, ["a", "b"], "restarts and cancel never re-create an execution");
  let releaseEvents!: (value: unknown) => void;
  const eventsWaiting = new Set<string>();
  const historyContext: CodingContext = { ...context, call: async <T>(target: string, args: Record<string, unknown>) => {
    if (target === "executions.answer") { assert.equal(args.runId, "r-b"); return { accepted: true } as T; }
    if (target !== "executions.events") return context.call<T>(target, args);
    assert.equal(args.waitMs, 15000);
    assert.equal(args.cursor, "opaque-cursor");
    eventsWaiting.add("ready");
    return new Promise<T>(resolve => { releaseEvents = value => resolve(value as T); });
  } };
  const history = handleWorkCommand(historyContext, { op: "events", workId: "b", runId: "r-b", attemptId: "t-b", cursor: "opaque-cursor", limit: 10, waitMs: 15000 });
  for (let tries = 0; !eventsWaiting.has("ready") && tries < 1000; tries++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(eventsWaiting.has("ready"), "history request reached execution store");
  assert.equal((await handleWorkCommand(historyContext, { op: "get", workId: "parent" }) as WorkView).workId, "parent", "pending event read never holds business controls");
  assert.deepEqual(await handleWorkCommand(historyContext, { op: "answer", workId: "b", runId: "r-b", attemptId: "t-b", requestId: "live-question", commandKey: "answer-during-events", answer: { decision: "submit", value: true } }), { accepted: true });
  assert.equal((await handleWorkCommand(historyContext, { op: "cancel", workId: "b", runId: "r-b", attemptId: "t-b", commandKey: "cancel-during-events" }) as WorkView).workId, "b");
  await assert.rejects(handleWorkCommand(historyContext, { op: "events", workId: "b", runId: "wrong-run", attemptId: "t-b", limit: 10, waitMs: 0 }), { code: "conflict" });
  await assert.rejects(handleWorkCommand({ ...historyContext, dir: join(dir, "other-owner") }, { op: "events", workId: "b", runId: "r-b", attemptId: "t-b", limit: 10, waitMs: 0 }), { code: "not_found" });
  releaseEvents({ events: [] }); await history;
  const aResult = (await readCodingWork(context, "a")).results[0]!;
  const bResult = (await readCodingWork(context, "b")).results[0]!;
  const refs = [aResult, bResult].map(({ workId, sessionId, runId, attemptId, resultId, artifactRef, baseline }) => ({ workId, sessionId, runId, attemptId, resultId, artifactRef, baseline }));
  const combined = await dependencyGoal(context, "review both", refs);
  assert.equal(combined, await dependencyGoal(context, "review both", [...refs].reverse()), "dependency data order deterministic");
  assert.ok(combined.includes("a 修改完成") && combined.includes("b 修改完成"));
  await assert.rejects(dependencyGoal(context, "bad ref", [{ ...refs[0]!, workId: "b" }]), { code: "conflict" });
  await assert.rejects(dependencyGoal(context, "bad result", [{ ...refs[0]!, resultId: "other-result" }]), { code: "conflict" });
  const originalText = await readFile(join(dir, "artifacts", `${refs[0]!.artifactRef}.json`), "utf8");
  const extra = { ...JSON.parse(originalText), privateRuntime: { logDir: "/private/runtime", secret: "synthetic-secret-not-public" } };
  const extraText = JSON.stringify(extra);
  const extraRef = { ...refs[0]!, resultId: `result-${createHash("sha256").update(extraText).digest("hex")}`, artifactRef: `coding-result-${createHash("sha256").update(extraText).digest("hex")}` };
  await writeFile(join(dir, "artifacts", `${extraRef.artifactRef}.json`), extraText);
  assert.equal((await dependencyGoal(context, "public only", [extraRef])).includes("synthetic-secret-not-public"), false);
  const invalidText = JSON.stringify({ ...JSON.parse(originalText), changes: { status: "invented" } });
  const invalidRef = { ...refs[0]!, resultId: `result-${createHash("sha256").update(invalidText).digest("hex")}`, artifactRef: `coding-result-${createHash("sha256").update(invalidText).digest("hex")}` };
  await writeFile(join(dir, "artifacts", `${invalidRef.artifactRef}.json`), invalidText);
  await assert.rejects(dependencyGoal(context, "schema", [invalidRef]), { code: "conflict" });
  await writeFile(join(dir, "artifacts", `${extraRef.artifactRef}.json`), extraText + " ");
  await assert.rejects(dependencyGoal(context, "changed artifact", [extraRef]), { code: "conflict" });
  const oversizedA = leaf("oversized-a"), oversizedB = { ...leaf("oversized-b", ["oversized-a"]), goal: "x".repeat(20_000) };
  await handleWorkCommand(context, { op: "start", input: workStartSchema.parse({ kind: "group", workId: "oversized-parent", commandKey: "oversized-parent-start", goal: "bounded context", children: [oversizedA, oversizedB] }) });
  executions.get("oversized-a")!.status = "completed"; executions.get("oversized-a")!.stopConfirmed = true;
  await assert.rejects(reconcileWorks(context, "oversized-parent"), { code: "too_large" });
  assert.equal(starts.includes("oversized-b"), false, "over-budget dependency context never dispatched");
  const oversized = (await readRegistry(context)).records.find(record => record.start.workId === "oversized-parent")!;
  assert.equal(oversized.views[2]!.dependencyResults[0]!.workId, "oversized-a", "consumed refs retained for diagnosis");
  assert.equal(oversized.dispatching.includes("oversized-b"), false);
  const oversizeCancelled = await handleWorkCommand(context, { op: "cancel", workId: "oversized-parent", commandKey: "cancel-oversized" }) as WorkView;
  assert.equal(oversizeCancelled.phase, "cancelled");
  const oversizeAfter = (await readRegistry(context)).records.find(record => record.start.workId === "oversized-parent")!;
  assert.equal(oversizeAfter.views[2]!.phase, "cancelled");
  assert.equal(oversizeAfter.views[2]!.execution, null);

  const tamperedA = leaf("tampered-a"), tamperedB = leaf("tampered-b", ["tampered-a"]);
  await handleWorkCommand(context, { op: "start", input: workStartSchema.parse({ kind: "group", workId: "tampered-parent", commandKey: "start-tampered-parent", goal: "validate before intent", children: [tamperedA, tamperedB] }) });
  executions.get("tampered-a")!.status = "completed"; executions.get("tampered-a")!.stopConfirmed = true;
  let tamperedPath = "", untamperedText = "";
  const tamperedContext: CodingContext = { ...context, call: async <T>(target: string, args: Record<string, unknown>) => {
    if (target === "executions.lookup-start" && args.commandKey === tamperedB.commandKey) {
      const record = (await readRegistry(context)).records.find(item => item.start.workId === "tampered-parent")!;
      tamperedPath = join(dir, "artifacts", `${record.views[2]!.dependencyResults[0]!.artifactRef}.json`);
      untamperedText = await readFile(tamperedPath, "utf8");
      await writeFile(tamperedPath, untamperedText + " ");
    }
    return context.call<T>(target, args);
  } };
  await assert.rejects(reconcileWorks(tamperedContext, "tampered-parent"), { code: "conflict" });
  const tamperedRecord = (await readRegistry(context)).records.find(record => record.start.workId === "tampered-parent")!;
  assert.equal(tamperedRecord.views[2]!.dependencyResults[0]!.workId, "tampered-a");
  assert.equal(tamperedRecord.dispatching.includes("tampered-b"), false);
  assert.equal(starts.includes("tampered-b"), false);
  await writeFile(tamperedPath, untamperedText);
  assert.equal((await handleWorkCommand(context, { op: "cancel", workId: "tampered-parent", commandKey: "cancel-tampered" }) as WorkView).phase, "cancelled");

  const lost = leaf("lost-network");
  let attemptedStarts = 0;
  const lostContext: CodingContext = { ...context, call: async <T>(target: string, args: Record<string, unknown>) => {
    if (target === "executions.start-v2" && args.workId === lost.workId) {
      attemptedStarts++;
      throw Object.assign(new Error("network start receipt lost"), { code: "unavailable" });
    }
    return context.call<T>(target, args);
  } };
  await assert.rejects(handleWorkCommand(lostContext, { op: "start", input: workStartSchema.parse({ kind: "group", workId: "lost-parent", commandKey: "start-lost-parent", goal: "unknown is not stopped", children: [lost] }) }), { code: "unavailable" });
  assert.equal((await handleWorkCommand(lostContext, { op: "cancel", workId: "lost-parent", commandKey: "cancel-lost-parent" }) as WorkView).phase, "stopping");
  const lostRecord = (await readRegistry(context)).records.find(record => record.start.workId === "lost-parent")!;
  assert.ok(lostRecord.dispatching.includes(lost.workId));
  assert.equal(lostRecord.views[1]!.phase, "unknown");
  assert.equal(lostRecord.views[1]!.execution, null);
  assert.equal(attemptedStarts, 1);
  const paging = { ...context, dir: join(dir, "paging") };
  const records = Array.from({ length: 8 }, (_, i) => {
    const start = { ...leaf(`page-${i}`), goal: "中".repeat(20_000) };
    const view: WorkView = { ...child, workId: start.workId, goal: start.goal, parentWorkId: null, dependsOnWorkIds: [], blockedBy: [], dependencyResults: [], execution: null, workspace: null, phase: "queued", cancelRequested: false, queueExpiresAt: start.queueExpiresAt };
    return { start, views: [view], dispatching: [], cancels: [] };
  });
  await saveRegistry(paging, { version: 1, records });
  const seen: string[] = [];
  let after: string | undefined;
  do {
    const page = await handleWorkCommand(paging, { op: "list", resource: "works", limit: 100, ...(after ? { after } : {}) }) as { works: WorkView[]; after: string | null };
    assert.ok(page.works.length > 0 && page.works.length < 8, "byte budget must shrink a Unicode page");
    assert.ok(Buffer.byteLength(JSON.stringify({ v: "chrona.execution.v2", requestId: "budget", ok: true, data: page })) <= 262_144);
    assert.ok(page.works.every(view => view.goal === "中".repeat(20_000)), "never truncate goals");
    seen.push(...page.works.map(view => view.workId));
    assert.ok(seen.length <= 8);
    after = page.after ?? undefined;
  } while (after);
  assert.deepEqual(seen, records.map(record => record.start.workId));
} finally { await rm(dir, { recursive: true, force: true }); }
