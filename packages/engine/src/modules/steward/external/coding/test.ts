import { strict as assert } from "node:assert";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodingToolInput, executionResultSchema, type ExecutionStart, type ExecutionView, type ExecutionSnapshot, type ExecutionResultSource } from "./contract.js";
import { createCodingWork, getCodingWork } from "./work";
import { readCodingWork, type CodingContext } from "./storage";
import { listCodingResults, acceptCodingResult } from "./results";
// @ts-expect-error Chrona supplies the isolated author test kernel.
import { startModule } from "chrona/testing";

const input: ExecutionStart = { workId: "w", projectRef: "repo", commandKey: "start-1", goal: "fix the fixture", budget: { timeoutMs: 1000, maxToolCalls: 1 } };
const view: ExecutionView = { workId: "w", sessionId: "s", runId: "r", attemptId: "a", projectRef: "repo", status: "running", cancelRequested: false, stopConfirmed: false };
const snapshot: ExecutionSnapshot = { workId: "w", sessionId: "s", runId: "r", attemptId: "a", status: "completed", cancelRequested: false, stopConfirmed: true, highWatermark: 1, finalMessage: { messageId: "m", text: "Changed fixture. Checks not run.", truncated: false }, questions: [], missing: false, expiresAt: "2026-12-01T00:00:00Z" };
const dir = await mkdtemp(join(tmpdir(), "coding-h-"));
let starts = 0, lookups = 0, lookupMissing = false, failStart = true;
const changes: NonNullable<ExecutionResultSource["changes"]> = { scope: "baseline_to_worktree", status: "complete", patch: "diff --git a/f b/f\n+change\n", files: [{ path: "f", kind: "tracked" }, { path: "new", kind: "untracked", text: "created" }] };
const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
  if (target === "executions.start") {
    starts++;
    assert.deepEqual(args, input);
    if (failStart) throw Object.assign(new Error("Lost start receipt"), { code: "unknown" });
    return { ...view } as T;
  }
  if (target === "executions.lookup-start") {
    lookups++;
    if (lookupMissing) throw Object.assign(new Error("No receipt"), { code: "not_found" });
    return { ...view } as T;
  }
  if (target === "executions.get") return { ...view } as T;
  if (target === "executions.snapshot") return { ...snapshot, status: view.status, stopConfirmed: view.stopConfirmed } as T;
  if (target === "executions.result-source") return { workId: "w", sessionId: "s", runId: "r", attemptId: "a", baseline: { kind: "commit", digest: "fixture-base" }, changes } as T;
  throw new Error(`Unexpected target ${target}`);
} };
try {
  assert.deepEqual(parseCodingToolInput("create", JSON.stringify(input)), input);
  assert.throws(() => parseCodingToolInput("create", JSON.stringify({ ...input, cwd: "/host" })));
  assert.throws(() => parseCodingToolInput("create", "null"));
  assert.deepEqual(parseCodingToolInput("answer", JSON.stringify({ workId: "w", runId: "r", attemptId: "a", commandKey: "k", requestId: "q", answer: { decision: "submit", value: true } })).answer, { decision: "submit", value: true });
  await assert.rejects(createCodingWork(context, input), { code: "unknown" });
  assert.deepEqual((await readCodingWork(context, "w")).start, input);
  // New context simulates a module restart: no new start until original key lookup resolves.
  await createCodingWork({ ...context }, input);
  assert.equal(starts, 1);
  assert.equal(lookups, 1);
  await assert.rejects(createCodingWork(context, { ...input, goal: "different" }), { code: "conflict" });
  assert.deepEqual(await listCodingResults(context, { workId: "w" }), { results: [] });
  view.status = "completed"; view.stopConfirmed = true;
  const first = (await listCodingResults(context, { workId: "w" })).results[0]!;
  assert.ok(executionResultSchema.safeParse(first).success);
  assert.equal(first.accepted, false);
  assert.deepEqual(first.checks, []);
  const bytes = await readFile(join(dir, "artifacts", `${first.artifactRef}.json`), "utf8");
  assert.equal(JSON.parse(bytes).finalMessage.text, snapshot.finalMessage!.text);
  assert.deepEqual(JSON.parse(bytes).changes, changes);
  assert.ok(Buffer.byteLength(bytes) <= 192 * 1024);
  assert.equal(await readFile(join(context.content, `${first.artifactRef}.json`), "utf8"), bytes);
  await rm(join(context.content, `${first.artifactRef}.json`));
  await getCodingWork({ ...context }, { workId: "w" });
  assert.equal((await readdir(join(dir, "artifacts"))).length, 1);
  assert.equal(await readFile(join(context.content, `${first.artifactRef}.json`), "utf8"), bytes);
  assert.equal((await listCodingResults(context, { workId: "w" })).results.length, 1);
  assert.deepEqual(await acceptCodingResult(context, { workId: "w", resultId: first.resultId, commandKey: "accept-1" }), { accepted: true });
  await acceptCodingResult(context, { workId: "w", resultId: first.resultId, commandKey: "accept-1" });
  await assert.rejects(acceptCodingResult(context, { workId: "w", resultId: "other", commandKey: "accept-1" }), { code: "conflict" });
  assert.equal((await readCodingWork(context, "w")).acceptances.length, 1);
  assert.equal(await readFile(join(dir, "artifacts", `${first.artifactRef}.json`), "utf8"), bytes);
  assert.equal(starts, 1);
  // A changed published file must never be silently overwritten by reconciliation.
  const published = join(context.content, `${first.artifactRef}.json`);
  await writeFile(published, "changed");
  await assert.rejects(getCodingWork(context, { workId: "w" }), { code: "conflict" });
  await rm(published);
  await getCodingWork(context, { workId: "w" });
  // Explicit repeat after a confirmed absent receipt reuses the original exact body.
  await rm(join(dir, "w.json"));
  await assert.rejects(createCodingWork(context, input), { code: "unknown" });
  lookupMissing = true; failStart = false;
  await createCodingWork(context, input);
  assert.equal(starts, 3);
  assert.equal(lookups, 2);
  changes.patch = "x".repeat(100_000);
  snapshot.finalMessage!.text = "\u0001".repeat(24_000);
  const bounded = (await listCodingResults(context, { workId: "w" })).results[0]!;
  const boundedText = await readFile(join(dir, "artifacts", `${bounded.artifactRef}.json`), "utf8");
  assert.ok(Buffer.byteLength(boundedText) <= 192 * 1024);
  assert.equal(JSON.parse(boundedText).changes.status, "partial");
  assert.equal(JSON.parse(boundedText).changes.reason, "limit");
  assert.equal(JSON.parse(boundedText).changes.patch, "");
  assert.deepEqual(JSON.parse(boundedText).checks, []);
} finally { await rm(dir, { recursive: true, force: true }); }

const runtime = await startModule("index.ts", { stubs: {
  "executions.list": () => ({ works: [], after: null }), "web.page-set": () => ({ id: "main" }), "schedules.create": () => ({ key: "coding-dependencies" }),
} });
try {
  const now = "2026-11-05T00:00:00Z";
  const invoke = (caller: object | undefined, input: string) => runtime.send({ trigger: { kind: "tool", id: "list", firedAt: now, args: { input }, ...(caller ? { caller } : {}) }, now, params: {} });
  const forbidden = await invoke(undefined, '{"limit":1}');
  assert.ok(forbidden.error);
  assert.equal((forbidden as { errorCode?: string }).errorCode, "forbidden");
  const invalid = await invoke({ kind: "owner", via: null }, '{"limit":0}');
  assert.ok(invalid.error);
  assert.equal((invalid as { errorCode?: string }).errorCode, "invalid");
  const providerAccept = await runtime.send({ trigger: { kind: "tool", id: "accept", firedAt: now, args: { input: JSON.stringify({ workId: "w", resultId: "result", commandKey: "accept" }) }, caller: { kind: "provider", runId: "p" } }, now, params: {} });
  assert.equal((providerAccept as { errorCode?: string }).errorCode, "forbidden");
  assert.deepEqual((await invoke({ kind: "provider", runId: "p" }, '{"limit":1}')).result?.result, { works: [], after: null });
  assert.deepEqual((await invoke({ kind: "module", module: "entry", moduleId: "entry-id", hash: "h" }, '{"limit":1}')).result?.result, { works: [], after: null });
  const internal = await runtime.send({ trigger: { kind: "tool", id: "reconcile", firedAt: now, args: { input: JSON.stringify({ workId: "w" }) }, caller: { kind: "owner", via: null } }, now, params: {} });
  assert.equal((internal as { errorCode?: string }).errorCode, "forbidden");
  const badWork = await runtime.send({ trigger: { kind: "tool", id: "work", firedAt: now, args: { input: "{}" }, caller: { kind: "owner", via: null } }, now, params: {} });
  assert.equal((badWork as { errorCode?: string }).errorCode, "invalid");
  assert.equal((await runtime.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} })).error, undefined);
} finally { await runtime.stop(); }
