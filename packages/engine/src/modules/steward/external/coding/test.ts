import { strict as assert } from "node:assert";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodingToolInput, executionResultSchema, type ExecutionStart, type ExecutionView, type ExecutionSnapshot, type ExecutionResultSource } from "./contract.js";
import { createCodingWork, getCodingWork } from "./work";
import { readCodingWork, type CodingContext } from "./storage";
import { listCodingResults, acceptCodingResult } from "./results";
import { codingGoal } from "./instructions";
import { codingSessions } from "./sessions";
// @ts-expect-error Chrona supplies the isolated author test kernel.
import { startModule } from "chrona/testing";

function camel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camel);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), camel(child)]));
}
const input: ExecutionStart = { workId: "w", projectRef: "repo", commandKey: "start-1", goal: "fix the fixture", budget: { timeoutMs: 1000, maxToolCalls: 1 } };
const view: ExecutionView = { workId: "w", sessionId: "s", runId: "r", attemptId: "a", projectRef: "repo", status: "running", cancelRequested: false, stopConfirmed: false };
const snapshot: ExecutionSnapshot = { workId: "w", sessionId: "s", runId: "r", attemptId: "a", status: "completed", cancelRequested: false, stopConfirmed: true, highWatermark: 1, finalMessage: { messageId: "m", text: "Changed fixture. Checks not run.", truncated: false }, questions: [], missing: false, expiresAt: "2026-12-01T00:00:00Z" };
const dir = await mkdtemp(join(tmpdir(), "coding-h-"));
let starts = 0, lookups = 0, lookupMissing = false, failStart = true;
const changes: NonNullable<ExecutionResultSource["changes"]> = { scope: "baseline_to_worktree", status: "complete", patch: "diff --git a/f b/f\n+change\n", files: [{ path: "f", kind: "tracked" }, { path: "new", kind: "untracked", text: "created" }] };
const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
  args = camel(args) as Record<string, unknown>;
  if (target === "agent.run") {
    args = { ...args, workId: args.executionId, commandKey: args.requestKey, goal: args.prompt };
    delete args.executionId; delete args.requestKey; delete args.prompt;
    starts++;
    assert.deepEqual(args, { ...input, goal: codingGoal(input.goal) });
    assert.ok(String(args.goal).includes("Report changes, checks actually run"));
    if (failStart) throw Object.assign(new Error("Lost start receipt"), { code: "unknown" });
    return { execution: { ...view } } as T;
  }
  if (target === "agent.lookup") {
    lookups++;
    if (lookupMissing) throw Object.assign(new Error("No receipt"), { code: "not_found" });
    return { ...view } as T;
  }
  if (target === "agent.get") return { ...view } as T;
  if (target === "agent.inspect") return { snapshot: { ...snapshot, status: view.status, stopConfirmed: view.stopConfirmed }, source: { workId: "w", sessionId: "s", runId: "r", attemptId: "a", baseline: { kind: "commit", digest: "fixture-base" }, changes } } as T;
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
  await codingSessions(context, { op: "create", id: "first", title: "First project" });
  await codingSessions(context, { op: "bind", id: "first", workId: "w" });
  await codingSessions(context, { op: "create", id: "second", title: "Second project" });
  const beforeSwitch = starts;
  await codingSessions(context, { op: "select", id: "second" });
  const restored = await codingSessions({ ...context }, { op: "select", id: "first" });
  assert.equal(restored.selected, "first");
  assert.equal(restored.sessions[0]!.selectedWorkId, "w");
  assert.equal(starts, beforeSwitch, "business session selection never launches a new execution");
  await assert.rejects(codingSessions(context, { op: "create", id: "first", title: "changed" }), { code: "conflict" });
  await assert.rejects(codingSessions(context, { op: "bind", id: "first", workId: "foreign" }), { code: "not_found" });
  await assert.rejects(codingSessions(context, { op: "select", id: "unknown" }), { code: "not_found" });
  await writeFile(join(dir, "sessions", "index.json"), "null");
  await assert.rejects(codingSessions(context, { op: "list" }), { code: "conflict" });
  await rm(join(dir, "sessions"), { recursive: true });
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

let readiness: Record<string, unknown> | undefined;
type Project = { projectRef: string; path: string; label: string };
let projects: Project[] = [], automatic: Project | undefined;
const registrations: Record<string, unknown>[] = [];
function registerProject(path: string) {
  let project = projects.find(project => project.path === path);
  if (!project) { project = { projectRef: `project-${projects.length}`, path, label: path.split("/").filter(Boolean).at(-1)! }; projects.push(project); }
  return project;
}
const runtime = await startModule("index.ts", { stubs: {
  "projects.list": () => ({ projects }),
  "projects.register": (args: Record<string, unknown>) => { registrations.push(args); return registerProject(String(args.path)); },
  "projects.default": (args: Record<string, unknown>) => {
    assert.deepEqual(Object.keys(args), args.path === undefined ? [] : ["path"]);
    if (args.path !== undefined || !automatic) automatic = registerProject(String(args.path ?? "/host/default"));
    return automatic;
  },
  "modules.report-health": (args: Record<string, unknown>) => { readiness = args; return { reportedAt: "2026-11-05T00:00:00Z", expiresAt: "2026-11-05T00:10:00Z" }; },
  "web.page-set": () => ({ id: "main" }), "schedules.create": () => ({ key: "coding-dependencies" }),
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
  assert.equal(readiness?.status, "needs_configuration");
  assert.ok(readiness.nextAction);
  for (const [choices, expected] of [[[{ projectRef: "repo", path: "/host/repo", label: "repo" }], "ready"], [[], "needs_configuration"]] as const) {
    projects = [...choices];
    assert.equal((await runtime.send({ trigger: { kind: "health", id: "health", firedAt: now }, now, params: {} })).error, undefined);
    assert.equal(readiness.status, expected);
  }
  const ui = async (id: string, args: Record<string, unknown> = {}) => {
    const reply = await runtime.send({ trigger: { kind: "tool", id, firedAt: now, args, caller: { kind: "owner", via: null } }, now, params: {} });
    assert.equal(reply.error, undefined);
    return reply.result?.result as Record<string, unknown>;
  };
  const catalog = await ui("ui-catalog");
  assert.equal(catalog.defaultProject, automatic!.projectRef);
  assert.equal(catalog.selectedSession, "");
  assert.deepEqual(catalog.sessions, []);
  assert.deepEqual(catalog.projectGroups, [{ ...automatic, isDefault: true, selected: true, sessions: [], hasSessions: false }]);
  const initial = await ui("ui-work");
  assert.equal(initial.project, automatic!.projectRef);
  assert.equal(initial.projectPath, "/host/default");
  assert.equal(initial.canSend, true);
  assert.equal(initial.sessionId, "");
  const register = { action: "register-project", "request-key": "directory", path: "/host/new project" };
  const providerRegister = await runtime.send({ trigger: { kind: "tool", id: "ui-command", firedAt: now, args: register, caller: { kind: "provider", runId: "p" } }, now, params: {} });
  assert.equal((providerRegister as { errorCode?: string }).errorCode, "forbidden");
  assert.equal(registrations.length, 0);
  const ownerRegister = await runtime.send({ trigger: { kind: "tool", id: "ui-command", firedAt: now, args: register, caller: { kind: "owner", via: null } }, now, params: {} });
  assert.equal(ownerRegister.error, undefined);
  assert.deepEqual(registrations, [{ path: "/host/new project" }]);
  const registered = projects.find(project => project.path === register.path)!;
  const registeredDraft = ownerRegister.result?.result as Record<string, unknown>;
  assert.equal(registeredDraft.project, registered.projectRef);
  assert.equal(registeredDraft.sessionId, "");
  assert.equal(registeredDraft.canSend, true);
  assert.equal((await ui("ui-work")).project, registered.projectRef);
  const custom = await ui("ui-command", { action: "default-project", "request-key": "custom-default", path: "/host/custom" });
  assert.equal(custom.projectPath, "/host/custom");
  assert.equal((await ui("ui-catalog")).defaultProject, custom.project);
  assert.equal((await ui("ui-command", { action: "new", "request-key": "scoped-draft", project: registered.projectRef })).project, registered.projectRef);
  assert.equal((await ui("ui-work")).project, registered.projectRef);
  assert.equal((await ui("ui-command", { action: "new", "request-key": "global-draft" })).project, custom.project);
  assert.equal((await ui("ui-command", { action: "default-project", "request-key": "current-default" })).project, custom.project);
  assert.deepEqual((await ui("ui-catalog")).sessions, []);
} finally { await runtime.stop(); }
