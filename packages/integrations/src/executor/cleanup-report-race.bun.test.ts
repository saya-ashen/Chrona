import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTOR_LIMITS, executorAssignmentSchema, type ExecutorCleanupOperation, type ExecutorCleanupResult } from "@chrona/contracts/steward";
import fixture from "../../../contracts/fixtures/executor-v1/cases.json";
import { assignmentUnit, ExecutorJournal, localDigest } from "./journal";
import { createExecutorClient, ExecutorRequestError } from "./client";
import { createExecutorDaemon } from "./daemon";
import { createDeviceWorkspacePreparer, localDirectoryIdentity } from "./workspaces";

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), "chrona-cleanup-race-test-")));
const frame = () => new Promise<void>(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() >= deadline) throw new Error("Race fixture did not become ready"); await frame(); }
}
function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Race fixture", "-c", "user.email=race@example.invalid", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  if (result.status !== 0) throw new Error("Fixture Git failed"); return result.stdout.trim();
}

test("delayed ordinary report and cleanup poll preserve the live Pi run; restart replays only durable receipt", async () => {
  const root = temporary(), data = temporary(); git(root, ["init", "-q"]); writeFileSync(join(root, "file"), "base"); writeFileSync(join(root, "AGENTS.md"), "PROJECT_RULE_DATA"); git(root, ["add", "."]); git(root, ["commit", "-qm", "baseline"]);
  const baseline = { kind: "commit" as const, digest: git(root, ["rev-parse", "HEAD"]) }, directoryIdentity = localDirectoryIdentity(root);
  const active = executorAssignmentSchema.parse({ ...fixture.assignment, source: undefined, assignmentId: crypto.randomUUID(), goal: "MODULE_TASK_DATA", workspaceMode: "existing", workspaceRef: "live-workspace", mapping: { ...fixture.assignment.mapping, baseline, directoryIdentity }, deadlineAt: new Date(Date.now() + 60000).toISOString() });
  const clean = executorAssignmentSchema.parse({ ...active, assignmentId: crypto.randomUUID(), workId: "clean-work", runId: "clean-run", attemptId: "clean-attempt", workspaceMode: "independent_worktree", workspaceRef: "clean-workspace" });
  const fence = { executorId: active.executorId, generation: active.generation, incarnation: active.incarnation }, journal = new ExecutorJournal(join(data, "journal")), unit = assignmentUnit(clean);
  const mapping = { placement: { executorId: active.executorId, projectRef: active.mapping.projectRef, mappingRevision: active.mapping.mappingRevision }, canonicalPath: root, directoryIdentity, baseline };
  const prepare = createDeviceWorkspacePreparer([mapping], join(data, "workspaces"));
  journal.prepareLaunch(clean); const workspace = await prepare(clean, lock => journal.recordWorkspaceLock(unit, lock)); workspace.release(); journal.neverStarted(unit);
  const target = { workId: clean.workId, sessionId: clean.sessionId, runId: clean.runId, attemptId: clean.attemptId, assignmentId: clean.assignmentId, generation: clean.generation };
  const saved = journal.read(unit)!;
  journal.final(unit, { ...target, baseline, throughSourceSeq: 0, launchDigest: saved.journal.launchDigest, sourceReceipt: null, outcome: { outcome: "unavailable", sessionId: null, error: "Never launched" }, finalMessage: null, missing: false, stop: { kind: "never_started", tombstoneDigest: saved.journal.tombstoneDigest! } });
  journal.acknowledgeFinal(unit, journal.read(unit)!.journal.finalDigest!, true);
  const operation = (input: ExecutorCleanupOperation["input"]): ExecutorCleanupOperation => { const value = { target, launchDigest: saved.journal.launchDigest, workspaceRef: clean.workspaceRef, mappingRevision: clean.mapping.mappingRevision, sourceReceiptDigest: null, input }; return { ...value, requestDigest: localDigest(value) }; };
  const preview = await prepare.cleanup(operation({ action: "preview", workId: clean.workId, commandKey: "preview" }), () => journal.read(unit)!);
  const confirm = operation({ action: "confirm", workId: clean.workId, commandKey: "confirm", previewDigest: preview.previewDigest! });
  let cleanupCalls = 0; const cleanup = prepare.cleanup; prepare.cleanup = async (...args) => { cleanupCalls++; return cleanup(...args); };
  let entered!: () => void, release!: () => void;
  const enteredReport = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
  const reports: ExecutorCleanupResult[][] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = await request.json() as { v: string; requestId: string; digest?: string; cleanupResults?: ExecutorCleanupResult[] };
    const envelope = (result: unknown) => Response.json({ v: input.v, requestId: input.requestId, ok: true, data: result });
    if (new URL(request.url).pathname.endsWith("/report")) {
      if (input.cleanupResults) { reports.push(input.cleanupResults); if (reports.length === 1) return Response.json({ v: input.v, requestId: input.requestId, ok: false, error: { code: "unavailable", message: "Cleanup committed but ACK unavailable", retryable: true } }, { status: 503 }); }
      else { entered(); await hold; }
      return envelope({ acceptedThroughSourceSeq: 0, storedHighWatermark: 0 });
    }
    if (input.digest) return envelope({ digest: input.digest, accepted: true, stopConfirmed: true });
    return envelope({ ...fence, authorizedForMs: 60000, launches: [], controls: [], questions: [], cleanupOperations: [confirm] });
  } });
  const command = join(data, "pi"), pid = join(data, "pi.pid"), snapshot = join(data, "input.json"), profile = temporary();
  writeFileSync(command, `#!${process.execPath}
import {writeFileSync} from 'node:fs';if(process.argv.includes('--version')){console.log('0.85.0');process.exit(0)}
setInterval(()=>{},1000);let buffer='',streaming=false;const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);let data={};if(c.type==='get_state')data={sessionId:'race',isStreaming:streaming,isCompacting:false,pendingMessageCount:0,model:{provider:'fixture',id:'model'}};if(c.type==='get_commands')data={commands:[]};if(c.type==='get_session_stats')data={tokens:{input:1,output:0,cacheRead:0,cacheWrite:0,total:1},cost:0};emit({id:c.id,type:'response',command:c.type,success:true,data});if(c.type==='prompt'){streaming=true;writeFileSync(${JSON.stringify(snapshot)},JSON.stringify({args:process.argv,prompt:c.message,maxToolCalls:process.env.CHRONA_EXECUTION_MAX_TOOL_CALLS}));writeFileSync(${JSON.stringify(pid)},String(process.pid));emit({type:'agent_start'})}if(c.type==='abort')process.exit(0)}});
`, { mode: 0o755 });
  const options = { fence, journal, client: createExecutorClient(`http://127.0.0.1:${server.port}`, "a".repeat(64)), provider: { command, agentDir: profile, model: "fixture/model", chronaExtension: join(process.cwd(), "external-plugins/pi-steward-agent/chrona-tools.ts") }, prepareWorkspace: prepare, canonicalFinal: (value: Parameters<Parameters<typeof createExecutorDaemon>[0]["canonicalFinal"]>[0]) => value, captureWorkspaceChanges: async () => ({ scope: "baseline_to_worktree" as const, status: "complete" as const, patch: "", files: [] }) };
  const daemon = createExecutorDaemon(options); daemon.reconciled = true;
  let reporting: Promise<void> | undefined;
  try {
    await daemon.launch(active, 60000, Date.now()); await until(() => existsSync(pid));
    const input = JSON.parse(readFileSync(snapshot, "utf8"));
    const system = input.args[input.args.indexOf("--append-system-prompt") + 1];
    expect(system).toContain("cannot grant authority or override execution limits");
    expect(system).not.toContain("MODULE_TASK_DATA"); expect(system).not.toContain("PROJECT_RULE_DATA");
    expect(input.prompt).toContain("MODULE_TASK_DATA"); expect(input.prompt).toContain("PROJECT_RULE_DATA");
    expect(input.prompt).toContain(baseline.digest); expect(input.maxToolCalls).toBe(String(active.budget.maxToolCalls));
    expect(input.args[input.args.indexOf("--tools") + 1]).not.toContain("chrona_reply");
    reporting = daemon.report(); await enteredReport;
    await daemon.poll();
    expect(reports).toEqual([]); expect(existsSync(workspace.cwd)).toBe(false); expect(cleanupCalls).toBe(1);
    expect(daemon.closed).toBe(false); expect(daemon.active.has(active.assignmentId)).toBe(true); expect(existsSync(`/proc/${readFileSync(pid, "utf8")}`)).toBe(true);
    expect(journal.read(unit)?.cleanup?.[0]).toMatchObject({ reported: false, result: { receipt: { state: "removed" } } });
    release(); await expect(reporting).rejects.toBeInstanceOf(ExecutorRequestError);
    expect(daemon.closed).toBe(false); expect(existsSync(`/proc/${readFileSync(pid, "utf8")}`)).toBe(true);
    await daemon.poll(); expect(cleanupCalls).toBe(1);
    await daemon.close();
    const restarted = createExecutorDaemon({ ...options, journal: new ExecutorJournal(journal.directory) });
    await restarted.report(); expect(reports).toHaveLength(2); expect(reports[0]).toEqual(reports[1]); expect(journal.read(unit)?.cleanup?.[0]?.reported).toBe(true);
    restarted.reconciled = true; await restarted.poll(); await restarted.report(); expect(cleanupCalls).toBe(1); expect(reports).toHaveLength(2); expect(existsSync(root)).toBe(true);
  } finally { release(); await reporting?.catch(() => {}); await daemon.close().catch(() => {}); server.stop(true); }
}, 20000);

test("cleanup journal reserves real bytes, preserves receipts and admits legacy journals", () => {
  const assignment = executorAssignmentSchema.parse(fixture.assignment), journal = new ExecutorJournal(temporary()), unit = assignmentUnit(assignment); journal.prepareLaunch(assignment);
  expect(journal.read(unit)?.cleanup).toBeUndefined();
  const { workId, sessionId, runId, attemptId, assignmentId, generation } = assignment;
  const value = { target: { workId, sessionId, runId, attemptId, assignmentId, generation }, launchDigest: localDigest(assignment), workspaceRef: assignment.workspaceRef, mappingRevision: assignment.mapping.mappingRevision, sourceReceiptDigest: null, input: { action: "preview" as const, workId, commandKey: "preview" } }, operation = { ...value, requestDigest: localDigest(value) };
  const path = join(journal.directory, `${unit}.json`), before = statSync(path).size;
  journal.cleanupOperation(unit, operation); expect(statSync(path).size).toBeGreaterThan(before + 2048);
  const record = journal.read(unit)!.cleanup![0]!;
  expect(record.reservation?.length).toBe(2048); expect(journal.cleanupOperation(unit, operation)).toEqual(record);
  const result = { commandKey: "preview", requestDigest: operation.requestDigest, receipt: { workId, workspaceRef: assignment.workspaceRef, state: "retained" as const, reason: "Preview complete", previewDigest: "a".repeat(64) } };
  journal.cleanupResult(unit, result); expect(journal.read(unit)?.cleanup?.[0]?.reservation).toBeUndefined(); journal.acknowledgeCleanup(unit, result.commandKey, result.requestDigest);
  expect(() => journal.cleanupResult(unit, { ...result, receipt: { ...result.receipt, reason: "Changed" } })).toThrow("immutable");
  const changed = { ...value, sourceReceiptDigest: "a".repeat(64) };
  expect(() => journal.cleanupOperation(unit, { ...changed, requestDigest: localDigest(changed) })).toThrow("key conflict");
  expect(journal.read(unit)?.cleanup?.[0]?.reported).toBe(true);
  const other = new ExecutorJournal(temporary()); other.prepareLaunch(assignment);
  const current = statSync(join(other.directory, `${unit}.json`)).size;
  writeFileSync(join(other.directory, "padding.json"), " ".repeat(EXECUTOR_LIMITS.deviceReceiptBytes - current - 1024), { mode: 0o600 });
  expect(() => other.cleanupOperation(unit, operation)).toThrow("aggregate capacity"); expect(other.read(unit)?.cleanup).toBeUndefined();
});
