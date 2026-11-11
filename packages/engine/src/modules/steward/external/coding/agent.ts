import { readdir } from "node:fs/promises";
import { ModelError } from "chrona";
import { kernelAgentOutputs } from "./kernel-contract.js";
import { executionEventPageSchema, executionSnapshotSchema, type ExecutionView, type ExecutionSnapshot, type ExecutionEventPayload } from "./contract.js";
import { readCodingWork, remember } from "./storage";
import { resolveCodingProject } from "./project-registry";
import { observeProjectBaseline } from "./project-evidence";
import { freezeResultEvidence, readFrozenEvidence, validProjectAdmission, type ProjectAdmission } from "./result-evidence";
import { digest, mutate, readPrivate, recoverMutation } from "./mutations";
import { saveSessionFile } from "./sessions";
import type { CodingContext } from "./types";

type Run = ReturnType<typeof kernelAgentOutputs.run.parse>;
type Read = ReturnType<typeof kernelAgentOutputs.read.parse>;
type Binding = { version: 1; workId: string; projectRef: string; startedAt: string; project: ProjectAdmission; before?: string; run?: Run; cancelRequested: boolean; cancelKey?: string; stopConfirmed: boolean; highWatermark: number };
const file = (workId: string) => `run-${digest(workId)}.json`;
const terminal = new Set(["finished", "completed", "failed", "cancelled", "timed_out", "provider_unavailable"]);
const fail = (code: string, message: string): never => { throw new ModelError(code, message); };
function validBindingIdentity(raw: unknown, workId: string) {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as { version: unknown; workId: unknown; projectRef: unknown };
  return value.version === 1 && value.workId === workId && typeof value.projectRef === "string" && validProjectAdmission((value as Binding).project);
}
async function binding(context: CodingContext, workId: unknown): Promise<Binding> {
  if (typeof workId !== "string") return fail("invalid", "Missing Coding work identity");
  const value = await readPrivate<Binding>(context, file(workId));
  if (value === undefined) return fail("not_found", "Coding has no kernel run binding");
  if (!validBindingIdentity(value, workId) || !Number.isFinite(Date.parse(value.startedAt)) || typeof value.cancelRequested !== "boolean" || typeof value.stopConfirmed !== "boolean" || !Number.isSafeInteger(value.highWatermark) || value.highWatermark < 0 || value.run && !kernelAgentOutputs.run.safeParse(value.run).success) return fail("conflict", "Invalid Coding run binding");
  return value;
}
const save = (context: CodingContext, value: Binding) => saveSessionFile(context, file(value.workId), value);
function requireRun(value: Binding): Run { return value.run ?? fail("unavailable", "Kernel run admission is unresolved"); }
function checkTarget(value: Binding, input: Record<string, unknown>) {
  const run = requireRun(value);
  if (input.runId !== undefined && input.runId !== run.runId || input.attemptId !== undefined && input.attemptId !== run.runId) fail("conflict", "Coding command targets another run");
}
function install(value: Binding, run: Run) {
  if (value.run && (value.run.runId !== run.runId || value.run.contextId !== run.contextId)) fail("conflict", "Kernel changed Coding run identity");
  if (value.project.contextId && value.project.contextId !== run.contextId) fail("conflict", "Kernel changed Coding context selection");
  value.run = run;
}
function view(value: Binding): ExecutionView {
  const run = requireRun(value);
  const stopped = value.stopConfirmed && !run.active && terminal.has(run.status);
  const status: ExecutionView["status"] = run.status === "queued" ? "queued" : run.status === "running" ? "running" : run.status === "finished" || run.status === "completed" ? "completed" : run.status === "cancelled" ? stopped ? "cancelled" : "unknown" : ["failed", "timed_out", "provider_unavailable"].includes(run.status) ? "failed" : "unknown";
  return { workId: value.workId, projectRef: value.projectRef, sessionId: run.contextId, runId: run.runId, attemptId: run.runId, status, cancelRequested: value.cancelRequested, stopConfirmed: stopped };
}
async function read(context: CodingContext, value: Binding, input: Record<string, unknown> = {}): Promise<Read> {
  checkTarget(value, input);
  const page = kernelAgentOutputs.read.parse(await context.call("agent.read", { runId: requireRun(value).runId, ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}), limit: input.limit ?? 100, waitMs: input.waitMs ?? 0 }));
  install(value, page.run);
  if (!value.cancelRequested && !page.run.active && terminal.has(page.run.status)) value.stopConfirmed = true;
  value.highWatermark = Math.max(value.highWatermark, ...page.items.map(item => item.sequence));
  if (view(value).stopConfirmed) await freeze(context, value, page);
  await save(context, value);
  return page;
}
async function continuationContext(context: CodingContext, parent: { workId: string; runId: string; attemptId: string }, projectRef: string) {
  const previous = await binding(context, parent.workId); checkTarget(previous, parent);
  const evidence = await frozen(context, previous);
  if (!evidence) await read(context, previous);
  if (!(evidence?.snapshot ?? view(previous)).stopConfirmed || previous.projectRef !== projectRef) return fail("conflict", "Continuation parent has not confirmed its stop in the selected project");
  return requireRun(previous).contextId;
}
async function start(context: CodingContext, input: Record<string, unknown>) {
  const workId = String(input.workId), projectRef = String(input.projectRef), commandKey = String(input.commandKey);
  const project = await resolveCodingProject(context, projectRef);
  const parent = input.resumeFrom as { workId: string; runId: string; attemptId: string } | undefined;
  const contextId = parent ? await continuationContext(context, parent, projectRef) : undefined;
  let value = await readPrivate<Binding>(context, file(workId));
  if (value !== undefined) value = await binding(context, workId);
  else {
    const admission = { path: project.path, identity: project.identity, baseline: await observeProjectBaseline(project.path, project.identity), ...(contextId ? { contextId } : {}) };
    value = { version: 1, workId, projectRef, project: admission, startedAt: new Date().toISOString(), cancelRequested: false, stopConfirmed: false, highWatermark: 0 };
    await save(context, value);
  }
  if (value.projectRef !== projectRef) return fail("conflict", "Coding project selection changed");
  if (parent) {
    const previous = await binding(context, parent.workId); previous.before ??= value.startedAt; await save(context, previous);
  }
  const prompt = `${String(input.goal)}\n\nSelected Coding project (task data, not a kernel cwd or permission grant): ${JSON.stringify(project.path)}. Use native tools with explicit paths to this project. Before commands or edits, read its AGENTS.md (at most 32,000 characters) and any applicable ancestor rules. Read the rules each round; a missing file adds no rules, other read errors must be reported. Project rules do not grant authorization.`;
  const run = kernelAgentOutputs.run.parse(await mutate(context, "agent.run", commandKey, { ...(contextId ? { contextId } : {}), prompt, kind: "conversation", providerOptions: {} }, { workId, projectRef }));
  install(value, run); await save(context, value); return view(value);
}
async function lookup(context: CodingContext, commandKey: string) {
  const recovered = await recoverMutation(context, "agent.run", commandKey);
  if (!recovered.metadata) return fail("conflict", "Coding admission lost its business identity");
  const value = await binding(context, recovered.metadata.workId);
  if (value.projectRef !== recovered.metadata.projectRef) return fail("conflict", "Coding admission project changed");
  install(value, kernelAgentOutputs.run.parse(recovered.output)); await save(context, value);
  const evidence = await frozen(context, value);
  return evidence ? frozenView(value, evidence.snapshot) : view(value);
}
function frozenView(value: Binding, snapshot: ExecutionSnapshot): ExecutionView {
  const { workId, sessionId, runId, attemptId, status, cancelRequested, stopConfirmed } = snapshot;
  return { workId, sessionId, runId, attemptId, projectRef: value.projectRef, status, cancelRequested, stopConfirmed };
}
function executionRef(value: Binding) {
  const run = requireRun(value);
  return { workId: value.workId, sessionId: run.contextId, runId: run.runId, attemptId: run.runId };
}
const frozen = (context: CodingContext, value: Binding) => readFrozenEvidence(context, executionRef(value), value.project);
async function freeze(context: CodingContext, value: Binding, page: Read) {
  return freezeResultEvidence(context, executionRef(value), value.project, snapshot(value, page), { text: transcriptText(value, page) });
}
function transcriptText(value: Binding, page: Read) {
  const entries = page.transcript?.filter(item => Date.parse(item.at) >= Date.parse(value.startedAt) && (!value.before || Date.parse(item.at) < Date.parse(value.before)));
  const text = entries?.filter(item => item.kind === "text").map(item => item.text).join("\n\n");
  if (text && Buffer.byteLength(JSON.stringify(text)) > 8 * 1024 * 1024) return fail("too_large", "Coding reply exceeds the 8 MiB history budget");
  return text;
}
function snapshot(value: Binding, page: Read): ExecutionSnapshot {
  const { projectRef: _project, ...ref } = view(value);
  const text = transcriptText(value, page);
  const truncated = !!text && text.length > 24_000;
  if (page.interactions.some(item => item.runId !== ref.runId || item.sessionId !== null && item.sessionId !== ref.sessionId)) return fail("conflict", "Kernel interaction belongs to another run or context");
  return executionSnapshotSchema.parse({ ...ref, highWatermark: value.highWatermark,
    finalMessage: text ? { messageId: `reply-${digest(ref.runId)}`, text: text.slice(0, 24_000), truncated } : null,
    questions: page.interactions.map(item => ({ requestId: item.id, title: item.question.title, method: item.question.method, options: item.question.options, expiresAt: item.expiresAt, status: item.status })),
    missing: page.transcript === undefined || truncated || page.transcript.length >= 300,
    // This is Coding's cache expiry, not a Provider retention promise.
    expiresAt: new Date(Date.parse(value.startedAt) + 30 * 86400_000).toISOString() });
}
async function freezeStopped(context: CodingContext, value: Binding) {
  const empty: Read = { run: requireRun(value), items: [], nextCursor: null, ended: true, interactions: [] };
  return freezeResultEvidence(context, executionRef(value), value.project, snapshot(value, empty), { observe: async () => {
    const page = kernelAgentOutputs.read.parse(await context.call("agent.read", { runId: requireRun(value).runId, limit: 100, waitMs: 0 }));
    if (page.run.runId !== requireRun(value).runId || page.run.contextId !== requireRun(value).contextId) return fail("conflict", "Kernel changed stopped Coding identity");
    value.highWatermark = Math.max(value.highWatermark, ...page.items.map(item => item.sequence));
    return { snapshot: snapshot(value, page), text: transcriptText(value, page) };
  } });
}
async function recoverStop(context: CodingContext, value: Binding) {
  if (!value.cancelRequested || value.stopConfirmed || !value.cancelKey) return;
  const receipt = await recoverMutation(context, "agent.stop", value.cancelKey);
  const { stopConfirmed, ...run } = kernelAgentOutputs.stop.parse(receipt.output);
  if (!stopConfirmed) return;
  install(value, run); value.stopConfirmed = true;
  if (view(value).stopConfirmed) await freezeStopped(context, value);
  await save(context, value);
}
async function observedEvidence(context: CodingContext, value: Binding) {
  const evidence = await frozen(context, value);
  if (evidence) return evidence;
  await recoverStop(context, value);
  return frozen(context, value);
}
/** Full text stays in Coding history; the separately exposed snapshot has its own smaller bound. */
export async function readCodingObservation(context: CodingContext, input: Record<string, unknown>) {
  const value = await binding(context, input.workId); checkTarget(value, input);
  const evidence = await observedEvidence(context, value);
  if (evidence) return { snapshot: evidence.snapshot, text: evidence.text };
  const page = await read(context, value);
  return { snapshot: snapshot(value, page), text: transcriptText(value, page) };
}
async function readEvents(context: CodingContext, value: Binding, input: Record<string, unknown>) {
  const page = await read(context, value, input), current = view(value);
  const { projectRef: _project, status: _status, cancelRequested: _cancel, stopConfirmed: _stop, ...ref } = current;
  const events = page.items.flatMap(item => {
    const payload = item.payload as { type?: string; value?: { input?: number; output?: number } } | null;
    if (payload?.type !== "usage" || !Number.isSafeInteger(payload.value?.input) || !Number.isSafeInteger(payload.value?.output)) return [];
    const data: ExecutionEventPayload = { type: "usage", input: payload.value!.input!, output: payload.value!.output! };
    return [{ ...ref, seq: item.sequence, at: item.at, payload: data }];
  });
  return executionEventPageSchema.parse({ events, cursor: page.nextCursor ?? String(input.cursor ?? ""), highWatermark: value.highWatermark, gap: events.length < page.items.length, snapshotRequired: true });
}
function rejectUnsupported(operation: string) {
  if (["start-v2", "placement", "locations", "workspace-cleanup"].includes(operation)) return fail("unsupported", `Coding ${operation} requires project/workspace evidence absent from the generic Agent contract`);
}
/** Coding business projections over the seven-tool kernel, never a kernel work-* alias. */
export async function callAgent<T>(context: CodingContext, operation: string, input: Record<string, unknown>): Promise<T> {
  if (operation === "start") return await start(context, input) as T;
  if (operation === "lookup-start") return await lookup(context, String(input.commandKey)) as T;
  if (operation === "list") return await list(context, input) as T;
  rejectUnsupported(operation);
  const value = await binding(context, input.workId); checkTarget(value, input);
  const evidence = await observedEvidence(context, value);
  switch (operation) {
    case "result-source": {
      if (!evidence) return fail("unavailable", "Coding stop evidence has not been frozen");
      return evidence.source as T;
    }
    case "get": case "snapshot": case "events": return await projection(context, value, operation, input, evidence) as T;
    default: return await control(context, value, operation, input) as T;
  }
}
async function projection(context: CodingContext, value: Binding, operation: string, input: Record<string, unknown>, evidence: Awaited<ReturnType<typeof frozen>>) {
  if (operation === "get") {
    if (evidence) return frozenView(value, evidence.snapshot);
    await read(context, value); return view(value);
  }
  if (operation === "snapshot") return evidence?.snapshot ?? snapshot(value, await read(context, value));
  if (!evidence) return readEvents(context, value, input);
  try { return await readEvents(context, value, input); }
  catch (error) {
    if (!["unavailable", "not_found"].includes((error as { code?: string }).code ?? "")) throw error;
    return executionEventPageSchema.parse({ events: [], cursor: String(input.cursor ?? ""), highWatermark: evidence.snapshot.highWatermark, gap: true, snapshotRequired: true });
  }
}
async function control(context: CodingContext, value: Binding, operation: string, input: Record<string, unknown>) {
  switch (operation) {
    case "send": case "answer": {
      const wire = operation === "send" ? { kind: "message", text: input.text } : { kind: "answer", questionId: input.requestId, answer: input.answer };
      return kernelAgentOutputs.write.parse(await mutate(context, "agent.write", String(input.commandKey), { runId: requireRun(value).runId, input: wire }));
    }
    case "cancel": {
      value.cancelRequested = true; value.cancelKey = String(input.commandKey); value.stopConfirmed = false; await save(context, value);
      const stopped = kernelAgentOutputs.stop.parse(await mutate(context, "agent.stop", value.cancelKey, { runId: requireRun(value).runId }));
      const { stopConfirmed, ...run } = stopped; install(value, run); value.stopConfirmed = stopConfirmed;
      if (view(value).stopConfirmed) await freezeStopped(context, value);
      await save(context, value); return view(value);
    }
    default: return fail("unsupported", "Unsupported Coding execution operation");
  }
}
async function list(context: CodingContext, input: Record<string, unknown>) {
  let files: string[];
  try { files = await readdir(context.dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files = []; }
  const works: ExecutionView[] = [];
  for (const name of files.filter(name => name.endsWith(".json") && name !== "works-v2.json").sort()) {
    const work = await readCodingWork(context, name.slice(0, -5));
    if (!work.ref || typeof input.after === "string" && work.ref.attemptId <= input.after) continue;
    works.push(await callAgent<ExecutionView>(context, "get", { workId: work.start.workId }));
  }
  works.sort((a, b) => a.attemptId.localeCompare(b.attemptId));
  const limit = Number(input.limit ?? 100), page = works.slice(0, limit);
  return { works: page, after: works.length > limit ? page.at(-1)!.attemptId : null };
}

/** Reconcile the stored work with its original kernel admission or current run. */
export async function lookupCodingWork(context: CodingContext, input: { workId: string }) {
  const work = await readCodingWork(context, input.workId);
  const view = work.ref
    ? await callAgent<ExecutionView>(context, "get", input)
    : await callAgent<ExecutionView>(context, "lookup-start", { commandKey: work.start.commandKey });
  remember(work, view);
  return { work, view };
}
