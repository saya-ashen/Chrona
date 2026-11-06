import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { WORK_LIMITS, executionStartV2Schema, workStartSchema, workViewSchema, executionStartSchema, type WorkStart, type WorkLeafStart, type WorkView, type WorkCommand, type WorkLocation, type ExecutionView, type ExecutionPlacementView } from "./contract.js";
import { codingError, readCodingWork, writeCodingWork, remember, type CodingContext, type CodingWork } from "./storage";
import { reconcileCodingResult, acceptCodingResult } from "./results";
import { installWorkspace } from "./workspaces";
import { dependencyGoal } from "./dependency-context";
import { readRegistry, saveRegistry, findWork, serializeWork, type WorkRegistry, type WorkRecord } from "./work-v2-storage";

function leaves(start: WorkStart): WorkLeafStart[] {
  return start.kind === "group" ? start.children.map(child => ({ ...child, parentWorkId: start.workId })) : [start];
}
function newView(start: WorkStart | WorkLeafStart): WorkView {
  return {
    workId: start.workId, kind: start.kind, goal: start.goal, parentWorkId: start.kind === "execution" ? start.parentWorkId ?? null : null,
    children: start.kind === "group" ? start.children.map(child => child.workId) : [],
    dependsOnWorkIds: start.kind === "execution" ? start.dependsOnWorkIds : [], blockedBy: start.kind === "execution" ? [...start.dependsOnWorkIds] : [], dependencyResults: [],
    queueExpiresAt: start.kind === "execution" ? start.queueExpiresAt : null,
    phase: start.kind === "execution" && start.dependsOnWorkIds.length ? "waiting_dependency" : "queued", cancelRequested: false,
    placement: start.kind === "execution" ? start.placement : null, workspace: null, execution: null,
  };
}
function same(left: unknown, right: unknown): boolean { return isDeepStrictEqual(left, right); }
export function workPhase(execution: ExecutionView): WorkView["phase"] {
  if (execution.cancelRequested && !execution.stopConfirmed) return "stopping";
  if (["completed", "failed", "cancelled"].includes(execution.status) && !execution.stopConfirmed) return "unknown";
  return execution.status;
}
export function groupPhase(children: WorkView[], cancelled: boolean): WorkView["phase"] {
  if (cancelled) return children.every(child => child.execution ? child.execution.stopConfirmed : child.phase === "cancelled") ? "cancelled" : "stopping";
  if (children.some(child => child.phase === "stopping")) return "stopping";
  if (children.some(child => child.phase === "unknown")) return "unknown";
  if (children.some(child => child.phase === "running")) return "running";
  if (children.every(child => child.phase === "completed")) return "completed";
  if (children.some(child => child.phase === "failed" || child.phase === "cancelled")) return "failed";
  return children.some(child => child.phase === "waiting_dependency") ? "waiting_dependency" : children.some(child => child.phase === "waiting_device") ? "waiting_device" : "queued";
}
async function assertNewIdentities(context: CodingContext, registry: WorkRegistry, items: (WorkStart | WorkLeafStart)[]) {
  const ids = new Set(registry.records.flatMap(record => record.views.map(view => view.workId)));
  const keys = new Set(registry.records.flatMap(record => [record.start.commandKey, ...leaves(record.start).map(leaf => leaf.commandKey)]));
  let files: string[];
  try { files = await readdir(context.dir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files = []; }
  for (const file of files.filter(file => file.endsWith(".json") && file !== "works-v2.json")) {
    const stored = JSON.parse(await readFile(join(context.dir, file), "utf8")) as { start: unknown };
    const legacy = executionStartSchema.parse(stored.start);
    keys.add(legacy.commandKey);
  }
  for (const item of items) {
    if (ids.has(item.workId) || keys.has(item.commandKey)) throw codingError("conflict", "Work identity or command key already registered");
    try { await readCodingWork(context, item.workId); throw codingError("conflict", "Work already exists in v1"); }
    catch (error) { if ((error as { code?: string }).code !== "not_found") throw error; }
  }
}
async function register(context: CodingContext, registry: WorkRegistry, raw: WorkStart) {
  const start = workStartSchema.parse(raw);
  const old = registry.records.find(record => record.start.commandKey === start.commandKey);
  if (old) { if (!same(old.start, start)) throw codingError("conflict", "Start key changed"); return old; }
  const items = start.kind === "group" ? [start, ...leaves(start)] : [start];
  await assertNewIdentities(context, registry, items);
  const now = Date.now();
  for (const leaf of leaves(start)) {
    const expires = Date.parse(leaf.queueExpiresAt);
    if (expires <= now || expires > now + WORK_LIMITS.queueMs) throw codingError("invalid", "Queue deadline outside admission window");
  }
  const record: WorkRecord = { start, views: items.map(newView), dispatching: [], cancels: [] };
  registry.records.push(record);
  await saveRegistry(context, registry);
  return record;
}
function legacyStart(leaf: WorkLeafStart) {
  return { workId: leaf.workId, commandKey: leaf.commandKey, projectRef: leaf.placement.projectRef, goal: leaf.goal, budget: leaf.budget };
}
async function installExecution(context: CodingContext, leaf: WorkLeafStart, view: WorkView, actual: ExecutionView) {
  let work: CodingWork;
  try { work = await readCodingWork(context, leaf.workId); }
  catch (error) { if ((error as { code?: string }).code !== "not_found") throw error; work = { start: legacyStart(leaf), results: [], acceptances: [] }; }
  if (!same(work.start, legacyStart(leaf))) throw codingError("conflict", "Execution start changed");
  remember(work, actual);
  await reconcileCodingResult(context, work, actual);
  await writeCodingWork(context, work);
  view.execution = actual;
  view.phase = workPhase(actual);
}
function verifySelection(leaf: WorkLeafStart, actual: ExecutionPlacementView) {
  if (actual.workspace.mode !== leaf.workspace.mode || !same(actual.workspace.baseline, leaf.workspace.baseline)) throw codingError("conflict", "Prepared workspace differs from selected source");
}
async function refreshLeaf(context: CodingContext, leaf: WorkLeafStart, view: WorkView) {
  if (!view.execution) return;
  const actual = await context.call<ExecutionView>("executions.get", { workId: leaf.workId });
  if (actual.runId !== view.execution.runId || actual.attemptId !== view.execution.attemptId || actual.sessionId !== view.execution.sessionId) throw codingError("conflict", "Execution attempt changed");
  await installExecution(context, leaf, view, actual);
  const placement = await context.call<ExecutionPlacementView>("executions.placement", { workId: leaf.workId });
  verifySelection(leaf, placement);
  installWorkspace(view, placement);
  if (view.phase === "queued" && !placement.online) view.phase = "waiting_device";
}
async function readDependencyResult(context: CodingContext, expected: ExecutionView) {
  const work = await readCodingWork(context, expected.workId);
  const result = work.results.find(item => item.attemptId === expected.attemptId);
  if (!result) return null;
  if (result.workId !== expected.workId || result.sessionId !== expected.sessionId || result.runId !== expected.runId) throw codingError("conflict", "Dependency result identity mismatch");
  const { workId, sessionId, runId, attemptId, resultId, artifactRef, baseline } = result;
  return { workId, sessionId, runId, attemptId, resultId, artifactRef, baseline };
}
async function dependencyResults(context: CodingContext, record: WorkRecord, view: WorkView) {
  const results: WorkView["dependencyResults"] = [];
  const blocked: string[] = [];
  for (const id of view.dependsOnWorkIds) {
    const dependency = record.views.find(item => item.workId === id)!;
    if (dependency.execution?.status !== "completed" || !dependency.execution.stopConfirmed) { blocked.push(id); continue; }
    const result = await readDependencyResult(context, dependency.execution);
    if (result) results.push(result); else blocked.push(id);
  }
  view.blockedBy = blocked;
  if (!blocked.length) {
    if (view.dependencyResults.length && !same(view.dependencyResults, results)) throw codingError("conflict", "Consumed dependency result changed");
    view.dependencyResults = results;
  }
}
async function dispatchLeaf(context: CodingContext, registry: WorkRegistry, record: WorkRecord, leaf: WorkLeafStart, view: WorkView) {
  if (view.execution || view.cancelRequested || record.views[0]!.cancelRequested) return;
  if (!record.dispatching.includes(leaf.workId) && Date.parse(leaf.queueExpiresAt) <= Date.now()) { view.phase = "failed"; return; }
  await dependencyResults(context, record, view);
  if (view.blockedBy.length) { view.phase = "waiting_dependency"; return; }
  // Preserve consumed references even when local dispatch validation rejects them.
  await saveRegistry(context, registry);
  let execution: ExecutionView;
  try { execution = await context.call<ExecutionView>("executions.lookup-start", { commandKey: leaf.commandKey }); }
  catch (error) {
    if ((error as { code?: string }).code !== "not_found") throw error;
    const { parentWorkId: _parent, dependsOnWorkIds: _dependencies, ...input } = leaf;
    const goal = await dependencyGoal(context, leaf.goal, view.dependencyResults);
    const dispatch = { ...input, goal };
    if (!executionStartV2Schema.safeParse(dispatch).success || Buffer.byteLength(JSON.stringify(dispatch)) > WORK_LIMITS.requestBytes) throw codingError("too_large", "User goal and dependency results exceed execution request budget; no dependent execution started");
    // Only a validated network start can leave an uncertain admission receipt.
    if (!record.dispatching.includes(leaf.workId)) record.dispatching.push(leaf.workId);
    await saveRegistry(context, registry);
    const admitted = await context.call<{ execution: ExecutionView; placement: ExecutionPlacementView }>("executions.start-v2", dispatch);
    execution = admitted.execution;
    verifySelection(leaf, admitted.placement);
    installWorkspace(view, admitted.placement);
  }
  await installExecution(context, leaf, view, execution);
  await saveRegistry(context, registry);
  await refreshLeaf(context, leaf, view);
}
async function cancelLeaf(context: CodingContext, record: WorkRecord, leaf: WorkLeafStart, commandKey: string) {
  const view = record.views.find(item => item.workId === leaf.workId)!;
  view.cancelRequested = true;
  // A lost start receipt may exist even though the local view has no execution yet.
  if (!view.execution && record.dispatching.includes(leaf.workId)) {
    try { await installExecution(context, leaf, view, await context.call<ExecutionView>("executions.lookup-start", { commandKey: leaf.commandKey })); }
    catch (error) { if ((error as { code?: string }).code !== "not_found") throw error; }
  }
  if (!view.execution) { view.phase = record.dispatching.includes(leaf.workId) ? "unknown" : "cancelled"; return; }
  if (view.execution.stopConfirmed) return;
  const key = createHash("sha256").update(`${commandKey}:${leaf.workId}`).digest("hex");
  const actual = await context.call<ExecutionView>("executions.cancel", { workId: leaf.workId, runId: view.execution.runId, attemptId: view.execution.attemptId, commandKey: key });
  await installExecution(context, leaf, view, actual);
}
async function applyCancels(context: CodingContext, registry: WorkRegistry, record: WorkRecord) {
  let failure: unknown;
  for (const command of record.cancels) {
    const targets = command.workId === record.start.workId && record.start.kind === "group" ? leaves(record.start) : leaves(record.start).filter(leaf => leaf.workId === command.workId);
    for (const leaf of targets) {
      try { await cancelLeaf(context, record, leaf, command.commandKey); }
      catch (error) {
        failure ??= error;
        record.views.find(view => view.workId === leaf.workId)!.phase = "unknown";
      }
      await saveRegistry(context, registry);
    }
  }
  if (failure) throw failure;
}
export async function advanceWorks(context: CodingContext, registry: WorkRegistry, record: WorkRecord) {
  // Stop requests must reach every known child even when a separate child cannot be read.
  await applyCancels(context, registry, record);
  for (const leaf of leaves(record.start)) await refreshLeaf(context, leaf, record.views.find(view => view.workId === leaf.workId)!);
  for (const leaf of leaves(record.start)) await dispatchLeaf(context, registry, record, leaf, record.views.find(view => view.workId === leaf.workId)!);
  if (record.start.kind === "group") record.views[0]!.phase = groupPhase(record.views.slice(1), record.views[0]!.cancelRequested);
  await saveRegistry(context, registry);
}
function page<T>(items: T[], limit: number, id: (item: T) => string, make: (rows: T[], after: string | null) => object) {
  const rows: T[] = [];
  for (const item of items.slice(0, limit)) {
    // Reserve the largest legal request id and envelope; never truncate a work's content.
    if (Buffer.byteLength(JSON.stringify(make([...rows, item], id(item)))) > WORK_LIMITS.responseBytes - 2048) break;
    rows.push(item);
  }
  if (items.length && !rows.length) throw codingError("too_large", "Work cannot fit response budget");
  return make(rows, rows.length < items.length ? id(rows.at(-1)!) : null);
}
async function listWorks(context: CodingContext, registry: WorkRegistry, command: Extract<WorkCommand, { op: "list" }>) {
    if (command.resource === "locations") return { resource: "locations", ...await context.call<{ locations: WorkLocation[]; after: string | null }>("executions.locations", { limit: command.limit, ...(command.after ? { after: command.after } : {}) }) };
    const views = registry.records.flatMap(record => record.views).filter(view => command.parentWorkId === undefined ? view.parentWorkId === null : view.parentWorkId === command.parentWorkId).sort((a, b) => (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0)).filter(view => !command.after || view.workId > command.after);
    return page(views, command.limit, view => view.workId, (works, after) => ({ resource: "works", works, after }));
}
async function lookupWork(context: CodingContext, registry: WorkRegistry, commandKey: string) {
    const record = registry.records.find(item => item.start.commandKey === commandKey || leaves(item.start).some(leaf => leaf.commandKey === commandKey));
    if (!record) throw codingError("not_found", "Start not found");
    const workId = record.start.commandKey === commandKey ? record.start.workId : leaves(record.start).find(leaf => leaf.commandKey === commandKey)!.workId;
    await advanceWorks(context, registry, record);
    return record.views.find(view => view.workId === workId);
}
async function requestCancel(context: CodingContext, registry: WorkRegistry, record: WorkRecord, view: WorkView, command: Extract<WorkCommand, { op: "cancel" }>) {
    if (view.execution ? command.runId !== view.execution.runId || command.attemptId !== view.execution.attemptId : command.runId !== undefined) throw codingError("conflict", "Cancel target does not match work");
    const old = record.cancels.find(item => item.commandKey === command.commandKey);
    if (old && !same(old, command)) throw codingError("conflict", "Cancel key changed");
    if (!old) record.cancels.push(command);
    view.cancelRequested = true;
    await saveRegistry(context, registry);
}
async function workResults(context: CodingContext, record: WorkRecord, view: WorkView) {
    const targets = view.kind === "group" ? record.views.slice(1) : [view];
    const results = [], missing = [];
    for (const child of targets) {
      if (!child.execution) { missing.push(child.workId); continue; }
      const work = await readCodingWork(context, child.workId);
      if (!work.results.length) missing.push(child.workId);
      results.push(...work.results);
    }
    return { results, missing };
}
function forwardExecution(context: CodingContext, view: WorkView, command: WorkCommand) {
  if (!view.execution || !("runId" in command) || command.runId !== view.execution.runId || command.attemptId !== view.execution.attemptId) throw codingError("conflict", "Operation requires the exact leaf execution");
  const { op, ...input } = command;
  return context.call(`executions.${op}`, input);
}
async function commandWork(context: CodingContext, registry: WorkRegistry, command: WorkCommand): Promise<unknown> {
  if (command.op === "start") {
    const record = await register(context, registry, command.input);
    await advanceWorks(context, registry, record);
    return record.views[0];
  }
  if (command.op === "list") return listWorks(context, registry, command);
  if (command.op === "lookup_start") return lookupWork(context, registry, command.commandKey);
  const { record, view } = findWork(registry, command.workId);
  if (command.op === "cancel") await requestCancel(context, registry, record, view, command);
  if (command.op === "detach") return { accepted: true };
  await advanceWorks(context, registry, record);
  if (command.op === "get" || command.op === "attach" || command.op === "cancel") return workViewSchema.parse(view);
  if (command.op === "results") return workResults(context, record, view);
  if (command.op === "accept") {
    if (view.kind === "group") throw codingError("invalid", "Select the exact child result");
    return acceptCodingResult(context, command);
  }
  return forwardExecution(context, view, command);
}
export function handleWorkCommand(context: CodingContext, command: WorkCommand): Promise<unknown> {
  if (command.op === "events") {
    // A history read must not hold the business journal lock while waiting for events.
    return serializeWork(async () => findWork(await readRegistry(context), command.workId).view)
      .then(view => forwardExecution(context, view, command));
  }
  return serializeWork(async () => commandWork(context, await readRegistry(context), command));
}

/** Schedule and trusted completion callbacks share exactly the same business reconciliation. */
export function reconcileWorks(context: CodingContext, workId?: string) {
  return serializeWork(async () => {
    const registry = await readRegistry(context);
    const records = workId ? [findWork(registry, workId).record] : registry.records;
    for (const record of records) await advanceWorks(context, registry, record);
    return { accepted: true as const };
  });
}
