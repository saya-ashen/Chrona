import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { EXECUTOR_PROTOCOL, executorDigest, type ExecutionPrincipal, type ExecutorAssignment, type ExecutionProjectGrantP2 } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { executionDigest } from "./execution-state";
import { createExecutionWorkspaceCleanup } from "./execution-workspace-cleanup";
import { createExecutionWorkspaceCleanupHost } from "../../../../../apps/server/src/execution-workspace-cleanup";
import { createServerWorkspacePreparer } from "../../../../../apps/server/src/execution-server-workspace";
import { localDirectoryIdentity, createDeviceWorkspacePreparer } from "../../../../integrations/src/executor/workspaces";
import { ExecutorJournal, assignmentUnit } from "../../../../integrations/src/executor/journal";
import { inspectExecutorUnit, recoverExecutorProcess, observeExecutorStop } from "../../../../integrations/src/executor/process";
import { createExecutorDaemon, drainExecutorFinals } from "../../../../integrations/src/executor/daemon";
import { createExecutorAuth } from "./executor-auth";
import { createExecutorControl } from "./executor-control";
import { createExecutionEventStore } from "./execution-event-store";
import { createRemoteCompletion } from "./execution-remote-completion";
import { parseExecutionPlacements } from "../../../../../apps/server/src/config/execution-projects";
import { createExecutorRouter } from "../../../../../apps/server/src/executor-router";
import { createExecutorClient } from "../../../../integrations/src/executor/client";
import { createRemoteExecutionSink } from "./executor-event-ingress";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "chrona-cleanup-cross-test-"));
  const git = (args: string[]) => { const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Cleanup test", "-c", "user.email=cleanup@example.invalid", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }); if (r.status !== 0) throw new Error("Git fixture failed"); return r.stdout.trim(); };
  git(["init", "-q"]); writeFileSync(join(root, "file"), "base"); git(["add", "."]); git(["commit", "-qm", "baseline"]);
  return { root, baseline: { kind: "commit" as const, digest: git(["rev-parse", "HEAD"]) }, identity: localDirectoryIdentity(root) };
}
async function setup(device: boolean) {
  const db = testDb(), project = repo(), dataDir = mkdtempSync(join(tmpdir(), "chrona-cleanup-host-test-")), now = new Date();
  const workspace = await db.workspace.create({ data: { name: "Cleanup cross-layer" } });
  const principal: ExecutionPrincipal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "owner" } };
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => now };
  ports.executionEvents = createExecutionEventStore(ports); ports.remoteCompletion = createRemoteCompletion(ports); ports.remoteExecutionSink = createRemoteExecutionSink(ports);
  const control = createExecutorControl(ports), auth = createExecutorAuth(ports); ports.executorAdmission = control.admission; ports.executorController = control.controller;
  const credential = randomBytes(32).toString("hex"), pairing = await auth.createPairing({ workspaceId: principal.workspaceId, ownerId: principal.ownerId });
  const paired = await auth.pair(credential, { v: EXECUTOR_PROTOCOL, requestId: "pair", code: pairing.code, label: "Cleanup device" });
  const fence = { executorId: paired.executorId, generation: 1, incarnation: "original" }, request = () => ({ v: EXECUTOR_PROTOCOL, requestId: crypto.randomUUID(), ...fence });
  await control.controller.reconcile(await auth.authenticateReconcile(credential, fence), { ...request(), entries: [], complete: true, after: null }, AbortSignal.timeout(5000));
  const who = await auth.authenticate(credential, fence, "active"), executorId = device ? paired.executorId : "server";
  const placement = { executorId, projectRef: "project", mappingRevision: 1 };
  let grant: ExecutionProjectGrantP2 = device ? { ...placement, executor: "device", executorGeneration: 1, directoryIdentity: project.identity, baseline: project.baseline, label: "Fixture" } : { ...placement, executor: "server", executorId: "server", executorGeneration: 1, directoryIdentity: project.identity, canonicalPath: project.root, baseline: project.baseline, label: "Fixture" };
  ports.resolveExecutionPlacement = async () => grant;
  const session = await db.session.create({ data: { workspaceId: workspace.id, key: crypto.randomUUID(), source: "web" } });
  const run = await db.run.create({ data: { workspaceId: workspace.id, sessionId: session.id, lane: "background", trigger: "execution", provider: "fixture", prompt: "cleanup", cwd: dataDir, status: "finished", startedAt: now, deadlineAt: new Date(now.getTime() + 60000), tokenHash: "fixture" } });
  const a = await db.executionAttempt.create({ data: { workspaceId: workspace.id, ownerId: "owner", callerKey: "owner", workId: "work", commandKey: "start", requestDigest: "fixture", runId: run.id, executorId, executorGeneration: 1, projectRef: "project", mappingRevision: 1, projectDigest: executionDigest(grant), directoryIdentity: project.identity, logDir: dataDir, baseline: `commit:${project.baseline.digest}`, budget: { timeoutMs: 60000, maxToolCalls: 2 }, workspaceRef: "workspace", workspaceMode: "independent_worktree", queueExpiresAt: new Date(now.getTime() + 60000), stopConfirmedAt: device ? null : now, stopEvidence: device ? undefined : { kind: "never_started" } } });
  const cleanup = createExecutionWorkspaceCleanup(ports, createExecutionWorkspaceCleanupHost(dataDir)); ports.executionWorkspaces = cleanup; ports.executionWorkspaceCleanupTransport = cleanup;
  return { db, ports, principal, control, auth, who, fence, request, project, a, run, cleanup, grant, dataDir, credential, setGrant: (value: typeof grant) => { grant = value; } };
}
test("server host with real SQLite verifies stop/holds and removes only owned independent tree", async () => {
  const f = await setup(false);
  try {
    const grant = f.grant; if (grant.executor !== "server") throw new Error("server fixture");
    const prepared = await createServerWorkspacePreparer(f.dataDir, f.ports.now).prepare({ principal: f.principal, grant, phase: "claim", attemptId: f.a.id, workspaceRef: "workspace", input: { kind: "execution", workId: "work", commandKey: "start", goal: "cleanup", placement: { executorId: "server", projectRef: "project", mappingRevision: 1 }, workspace: { mode: "independent_worktree", baseline: f.project.baseline }, queueExpiresAt: f.a.queueExpiresAt!.toISOString(), budget: { timeoutMs: 60000, maxToolCalls: 2 } } }); prepared.release();
    const p = await f.cleanup.cleanup(f.principal, { action: "preview", workId: "work", commandKey: "preview" }); expect(p.state).toBe("retained");
    await f.db.executionAttempt.update({ where: { id: f.a.id }, data: { heldDirectory: "held" } });
    await expect(f.cleanup.cleanup(f.principal, { action: "confirm", workId: "work", commandKey: "held", previewDigest: p.previewDigest! })).rejects.toMatchObject({ code: "conflict" });
    await f.db.executionAttempt.update({ where: { id: f.a.id }, data: { heldDirectory: null } });
    const input = { action: "confirm" as const, workId: "work", commandKey: "confirm", previewDigest: p.previewDigest! }, result = await f.cleanup.cleanup(f.principal, input);
    expect(result.state).toBe("removed"); expect(existsSync(prepared.cwd)).toBe(false); expect(existsSync(f.project.root)).toBe(true); expect(await f.cleanup.cleanup(f.principal, input)).toEqual(result);
  } finally { await f.db.$disconnect(); }
});
test("device daemon/controller exact cleanup preview-confirm, stable receipt and mixed stream rejection", async () => {
  const f = await setup(true), router = createExecutorRouter(f.ports), server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: router.fetch });
  try {
    const mapping = { executorId: f.fence.executorId, projectRef: "project", mappingRevision: 1, directoryIdentity: f.project.identity, baseline: f.project.baseline, label: "Fixture" };
    const assignment: ExecutorAssignment = { workId: "work", sessionId: f.run.sessionId!, runId: f.run.id, attemptId: f.a.id, assignmentId: "cleanup-assignment", generation: 1, executorId: f.fence.executorId, incarnation: "original", mapping, workspaceRef: "workspace", workspaceMode: "independent_worktree", goal: "cleanup", budget: { timeoutMs: 60000, maxToolCalls: 2 }, deadlineAt: f.run.deadlineAt!.toISOString() };
    await f.db.executorAssignment.create({ data: { attemptId: f.a.id, assignmentId: assignment.assignmentId, executorId: assignment.executorId, generation: 1, incarnation: "original", launch: assignment, launchDigest: await executorDigest(assignment), preparedAt: f.ports.now(), offeredAt: f.ports.now() } });
    await f.ports.executionEvents!.admit(f.db, f.principal, assignment);
    const journal = new ExecutorJournal(join(f.dataDir, "device-journal")), unit = assignmentUnit(assignment); journal.prepareLaunch(assignment);
    const preparer = createDeviceWorkspacePreparer([{ placement: { executorId: assignment.executorId, projectRef: "project", mappingRevision: 1 }, canonicalPath: f.project.root, directoryIdentity: f.project.identity, baseline: f.project.baseline }], join(f.dataDir, "device-workspaces"));
    const prepared = await preparer(assignment, lock => journal.recordWorkspaceLock(unit, lock)); prepared.release(); journal.neverStarted(unit);
    const final = { ...assignment, throughSourceSeq: 0, launchDigest: await executorDigest(assignment), baseline: f.project.baseline, outcome: { outcome: "unavailable" as const, sessionId: null, error: "Never launched" }, finalMessage: null, missing: false, sourceReceipt: null, stop: { kind: "never_started" as const, tombstoneDigest: journal.read(unit)!.journal.tombstoneDigest! } };
    // Wire final contains only the fixed target, not launch-only assignment fields.
    const { workId, sessionId, runId, attemptId, assignmentId, generation } = assignment;
    const wireFinal = { workId, sessionId, runId, attemptId, assignmentId, generation, throughSourceSeq: final.throughSourceSeq, launchDigest: final.launchDigest, baseline: final.baseline, outcome: final.outcome, finalMessage: null, missing: false, sourceReceipt: null, stop: final.stop };
    journal.final(unit, wireFinal); const ack = await f.control.controller.final(f.who, { ...f.request(), digest: await executorDigest(wireFinal), final: wireFinal }, AbortSignal.timeout(5000)); journal.acknowledgeFinal(unit, ack.digest, ack.stopConfirmed);
    const daemon = createExecutorDaemon({ fence: f.fence, journal, client: createExecutorClient(`http://127.0.0.1:${server.port}`, f.credential), provider: { agentDir: join(f.dataDir, "unused-profile"), model: "unused", chronaExtension: "unused" }, prepareWorkspace: preparer, canonicalFinal: value => value, captureWorkspaceChanges: async () => ({ scope: "baseline_to_worktree", status: "complete", patch: "", files: [] }) }); daemon.reconciled = true;
    const previewInput = { action: "preview" as const, workId: "work", commandKey: "preview" }; expect((await f.cleanup.cleanup(f.principal, previewInput)).state).toBe("unknown"); await daemon.poll(); await daemon.report();
    const preview = await f.cleanup.cleanup(f.principal, previewInput); expect(preview.state).toBe("retained");
    const originalCommand = await f.db.executionCommand.findUniqueOrThrow({ where: { attemptId_commandKey: { attemptId, commandKey: "preview" } } });
    const envelope = originalCommand.receipt as { operation: { requestDigest: string } };
    const result = { commandKey: "preview", requestDigest: envelope.operation.requestDigest, receipt: preview };
    await expect(f.control.controller.report(f.who, { ...f.request(), target: wireFinal, records: [], cleanupResults: [{ ...result, requestDigest: "0".repeat(64) }] }, AbortSignal.timeout(5000))).rejects.toMatchObject({ code: "conflict" });
    await expect(f.control.controller.report(f.who, { ...f.request(), target: { ...wireFinal, workId: "other-work" }, records: [], cleanupResults: [result] }, AbortSignal.timeout(5000))).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.control.controller.report({ ...f.who, incarnation: "stale" }, { ...f.request(), incarnation: "stale", target: wireFinal, records: [], cleanupResults: [result] }, AbortSignal.timeout(5000))).rejects.toMatchObject({ code: "forbidden" });
    const confirm = { action: "confirm" as const, workId: "work", commandKey: "confirm", previewDigest: preview.previewDigest! }; await f.cleanup.cleanup(f.principal, confirm); await daemon.poll(); await daemon.report();
    const removed = await f.cleanup.cleanup(f.principal, confirm); expect(removed.state).toBe("removed"); expect(await f.cleanup.cleanup(f.principal, confirm)).toEqual(removed); expect(existsSync(prepared.cwd)).toBe(false); expect(existsSync(f.project.root)).toBe(true);
    await expect(f.control.controller.report(f.who, { ...f.request(), target: wireFinal, records: [], started: { identity: { unit, invocationId: "d".repeat(32), controlGroup: "/bad", bootId: "00000000-0000-4000-8000-000000000001" }, launchDigest: final.launchDigest, sourceReceipt: null }, cleanupResults: [{ commandKey: "confirm", requestDigest: "0".repeat(64), receipt: removed }] }, AbortSignal.timeout(5000))).rejects.toMatchObject({ code: "conflict" });
    await f.cleanup.cleanup(f.principal, { ...previewInput, commandKey: "stale" }); f.setGrant({ ...f.grant, label: "changed mapping" });
    expect((await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(5000))).cleanupOperations).toEqual([]);
    expect((await f.cleanup.cleanup(f.principal, { ...previewInput, commandKey: "stale" })).state).toBe("blocked");
    f.setGrant(f.grant);
    await f.cleanup.cleanup(f.principal, { ...previewInput, commandKey: "removed-mapping" });
    f.ports.resolveExecutionPlacement = parseExecutionPlacements({ projects: [], placements: [] });
    const healthyPoll = await f.control.controller.poll(f.who, { ...f.request(), waitMs: 0 }, AbortSignal.timeout(5000));
    expect(healthyPoll.cleanupOperations).toEqual([]); expect(healthyPoll.authorizedForMs).toBeGreaterThan(0);
    expect((await f.cleanup.cleanup(f.principal, { ...previewInput, commandKey: "removed-mapping" })).state).toBe("blocked");
    f.ports.resolveExecutionPlacement = async () => f.grant;
    f.ports.now = () => new Date(Date.now() + 31 * 86400000);
    await f.db.$transaction(tx => f.control.retire(tx));
    expect(await f.cleanup.cleanup(f.principal, confirm)).toEqual(removed);
  } finally { server.stop(true); await f.db.$disconnect(); }
}, 20000);

for (const scenario of ["started", "missing-started", "revoked-drain"] as const) test(`real systemd daemon recovery without respawn; scenario=${scenario}`, async () => {
  const receivedStarted = scenario !== "missing-started", f = await setup(true), router = createExecutorRouter(f.ports);
  let finalRequests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const response = await router.fetch(request);
    if (new URL(request.url).pathname.endsWith("/final")) { finalRequests++; if (scenario === "revoked-drain" && finalRequests === 1) return new Response("Lost final ACK", { status: 503 }); }
    return response;
  } });
  const { root, baseline, identity } = f.project, marker = join(f.dataDir, "prompt-count"), command = join(f.dataDir, "fake-pi");
  const assignment: ExecutorAssignment = { workId: "work", sessionId: f.run.sessionId!, runId: f.run.id, attemptId: f.a.id, assignmentId: crypto.randomUUID(), generation: 1, executorId: f.fence.executorId, incarnation: "original", mapping: { executorId: f.fence.executorId, projectRef: "project", mappingRevision: 1, directoryIdentity: identity, baseline, label: "Fixture" }, source: { files: [{ path: "file", sha256: new Bun.CryptoHasher("sha256").update("base").digest("hex") }] }, workspaceRef: "workspace", workspaceMode: "independent_worktree", goal: "controlled crash", budget: { timeoutMs: 60000, maxToolCalls: 2 }, deadlineAt: new Date(Date.now() + 60000).toISOString() };
  mkdirSync(join(f.dataDir, "isolated-profile"), { mode: 0o700 });
  const unit = assignmentUnit(assignment), journalDir = join(f.dataDir, "crash-journal"), managedRoot = join(f.dataDir, "crash-workspaces"), journal = new ExecutorJournal(journalDir);
  writeFileSync(command, `#!${process.execPath}
import {appendFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('0.85.0');process.exit(0)}
let buffer='';setInterval(()=>{},1000);process.stdin.setEncoding('utf8');
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);let data={};if(c.type==='get_state')data={sessionId:'crash-session',isStreaming:true,isCompacting:false,pendingMessageCount:0,model:{provider:'fixture',id:'model'}};if(c.type==='get_commands')data={commands:[]};if(c.type==='get_session_stats')data={sessionId:'crash-session',tokens:{input:1,output:0,cacheRead:0,cacheWrite:0,total:1},cost:0};emit({id:c.id,type:'response',command:c.type,success:true,data});if(c.type==='prompt'){appendFileSync(${JSON.stringify(marker)},'prompt\\n');appendFileSync(${JSON.stringify(marker + '.pid')},String(process.pid));emit({type:'agent_start'})}}});
`, { mode: 0o755 });
  const worker = join(f.dataDir, "daemon-worker.ts"), mapping = { placement: { executorId: assignment.executorId, projectRef: "project", mappingRevision: 1 }, canonicalPath: root, directoryIdentity: identity, baseline };
  writeFileSync(worker, `import {createExecutorDaemon} from ${JSON.stringify(join(import.meta.dir, "../../../../integrations/src/executor/daemon.ts"))};
import {ExecutorJournal} from ${JSON.stringify(join(import.meta.dir, "../../../../integrations/src/executor/journal.ts"))};
import {createDeviceWorkspacePreparer} from ${JSON.stringify(join(import.meta.dir, "../../../../integrations/src/executor/workspaces.ts"))};
import {createExecutorClient} from ${JSON.stringify(join(import.meta.dir, "../../../../integrations/src/executor/client.ts"))};
const a=${JSON.stringify(assignment)};const daemon=createExecutorDaemon({fence:${JSON.stringify(f.fence)},journal:new ExecutorJournal(${JSON.stringify(journalDir)}),client:createExecutorClient(${JSON.stringify('http://127.0.0.1:') }+${JSON.stringify(String(server.port))},process.env.CHRONA_TEST_DEVICE_CREDENTIAL!),provider:{command:${JSON.stringify(command)},agentDir:${JSON.stringify(join(f.dataDir,"isolated-profile"))},model:'fixture/model',chronaExtension:${JSON.stringify(join(process.cwd(),"external-plugins/pi-steward-agent/chrona-tools.ts"))}},prepareWorkspace:createDeviceWorkspacePreparer([${JSON.stringify(mapping)}],${JSON.stringify(managedRoot)}),canonicalFinal:x=>x,captureWorkspaceChanges:async()=>({scope:'baseline_to_worktree',status:'complete',patch:'',files:[]})});process.on('SIGTERM',async()=>{try{await daemon.close();process.exit(0)}catch{process.exit(2)}});await daemon.launch(a,60000,Date.now());await new Promise(()=>{});`);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const waitFor = async (check: () => boolean | Promise<boolean>) => { const end = Date.now() + 10000; while (Date.now() < end) { if (await check()) return; await Bun.sleep(25); } throw new Error("Recovery fixture timed out"); };
  try {
    await f.db.run.update({ where: { id: f.run.id }, data: { status: "running" } });
    await f.db.executionAttempt.update({ where: { id: f.a.id }, data: { sourceManifest: assignment.source, heldDirectory: "logical-held" } });
    await f.db.executorAssignment.create({ data: { attemptId: f.a.id, assignmentId: assignment.assignmentId, executorId: assignment.executorId, generation: 1, incarnation: "original", launch: assignment, launchDigest: await executorDigest(assignment), offeredAt: f.ports.now(), preparedAt: f.ports.now() } });
    await f.ports.executionEvents!.admit(f.db, f.principal, assignment);
    child = Bun.spawn([process.execPath, worker], { env: { ...process.env, CHRONA_TEST_DEVICE_CREDENTIAL: f.credential }, stdout: Bun.file(join(f.dataDir, "worker-out.log")), stderr: Bun.file(join(f.dataDir, "worker-error.log")) });
    await waitFor(() => existsSync(marker) && !!journal.read(unit)?.journal.identity);
    const original = journal.read(unit)!; expect(original.prepared?.sourceReceipt?.fileCount).toBe(1);
    const running = inspectExecutorUnit(unit);
    expect(() => observeExecutorStop({ ...original, supervisionRoot: "0".repeat(64) }, { ...running, ActiveState: "failed", SubState: "failed", MainPID: "0", ControlGroup: "" })).toThrow();
    expect(recoverExecutorProcess(journal, unit).state).not.toBe("stopped");
    if (receivedStarted) await f.control.controller.report(f.who, { ...f.request(), target: assignment, records: [], started: { identity: original.journal.identity!, launchDigest: original.journal.launchDigest, sourceReceipt: original.prepared!.sourceReceipt } }, AbortSignal.timeout(5000));
    if (scenario === "revoked-drain") {
      await f.auth.revoke({ workspaceId: f.principal.workspaceId, ownerId: f.principal.ownerId }, { executorId: f.fence.executorId, generation: 1, commandKey: "revoke" });
      child.kill("SIGTERM"); expect(await child.exited).toBe(2);
      expect(journal.read(unit)?.observation).not.toBeNull(); expect(journal.read(unit)?.ack?.stopConfirmed).not.toBe(true);
      await drainExecutorFinals({ client: createExecutorClient(`http://127.0.0.1:${server.port}`, f.credential), fence: f.fence, journal });
      expect(journal.read(unit)?.ack?.stopConfirmed).toBe(true); expect(finalRequests).toBe(2);
      expect((await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.a.id } })).heldDirectory).toBeNull();
      expect(await Bun.file(marker).text()).toBe("prompt\n"); return;
    }
    child.kill("SIGKILL"); await child.exited;
    if (receivedStarted) {
      spawnSync("systemctl", ["--user", "kill", "--kill-whom=main", "--signal=SIGKILL", unit]);
      await Bun.sleep(50);
      expect(existsSync(`/proc/${await Bun.file(`${marker}.pid`).text()}`)).toBe(true);
      expect(recoverExecutorProcess(journal, unit).state).not.toBe("stopped");
    }
    await f.auth.prepareIncarnation({ workspaceId: f.principal.workspaceId, ownerId: f.principal.ownerId }, { executorId: f.fence.executorId, generation: 1, expectedIncarnation: "original", nextIncarnation: "replacement", commandKey: "owner-restart" });
    const client = createExecutorClient(`http://127.0.0.1:${server.port}`, f.credential), preparer = createDeviceWorkspacePreparer([mapping], managedRoot);
    const restarted = createExecutorDaemon({ client, journal: new ExecutorJournal(journalDir), fence: { ...f.fence, incarnation: "replacement" }, provider: { command, agentDir: join(f.dataDir, "isolated-profile"), model: "fixture", chronaExtension: "unused" }, prepareWorkspace: preparer, canonicalFinal: value => value, captureWorkspaceChanges: async () => { throw new Error("Recovery must not capture or start"); } });
    await restarted.reconcile();
    await waitFor(async () => { await restarted.report(); return !!journal.read(unit)?.ack?.stopConfirmed; }).catch(error => { writeFileSync(join(f.dataDir, "manager-after-failure.json"), JSON.stringify(inspectExecutorUnit(unit), null, 2)); throw error; });
    const after = journal.read(unit)!; expect(after.journal.final).toMatchObject({ missing: true, outcome: { outcome: "unavailable" }, sourceReceipt: original.prepared!.sourceReceipt }); expect(after.journal.final?.changes).toBeUndefined();
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.a.id } })).toMatchObject({ heldDirectory: null, sourceReceipt: original.prepared!.sourceReceipt });
    const row = await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: f.a.id } }); expect(row.finalizedAt).not.toBeNull(); expect(row.processIdentity).toEqual(original.journal.identity);
    await restarted.report(); expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: f.a.id } })).finalDigest).toBe(row.finalDigest);
    expect(await Bun.file(marker).text()).toBe("prompt\n");
  } finally {
    if (child && child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    spawnSync("systemctl", ["--user", "kill", "--kill-whom=all", "--signal=SIGKILL", unit]); spawnSync("systemctl", ["--user", "stop", unit]); server.stop(true); await f.db.$disconnect();
  }
}, 30000);

for (const invalid of ["unit", "source", "drain", "watermark"] as const) test(`first recovery identity rejects invalid ${invalid}`, async () => {
  const f = await setup(true);
  try {
    const assignment: ExecutorAssignment = { workId: "work", sessionId: f.run.sessionId!, runId: f.run.id, attemptId: f.a.id, assignmentId: crypto.randomUUID(), generation: 1, executorId: f.fence.executorId, incarnation: "original", mapping: { executorId: f.fence.executorId, projectRef: "project", mappingRevision: 1, directoryIdentity: f.project.identity, baseline: f.project.baseline, label: "Fixture" }, workspaceRef: "workspace", workspaceMode: "independent_worktree", goal: "negative recovery", budget: { timeoutMs: 60000, maxToolCalls: 2 }, deadlineAt: f.run.deadlineAt!.toISOString(), ...(invalid === "source" ? { source: { files: [{ path: "file", sha256: "a".repeat(64) }] } } : {}) };
    const launchDigest = await executorDigest(assignment), unit = assignmentUnit(assignment);
    await f.db.executionAttempt.update({ where: { id: f.a.id }, data: { heldDirectory: "original-hold" } });
    await f.db.executorAssignment.create({ data: { attemptId: f.a.id, assignmentId: assignment.assignmentId, executorId: assignment.executorId, generation: 1, incarnation: "original", launch: assignment, launchDigest, preparedAt: f.ports.now(), offeredAt: f.ports.now(), sourceHighWatermark: invalid === "watermark" ? 1 : 0 } });
    await f.ports.executionEvents!.admit(f.db, f.principal, assignment);
    const { workId, sessionId, runId, attemptId, assignmentId, generation } = assignment;
    const final = { workId, sessionId, runId, attemptId, assignmentId, generation, launchDigest, baseline: f.project.baseline, throughSourceSeq: 0, sourceReceipt: null, outcome: { outcome: "unavailable" as const, sessionId: null, error: "Interrupted" }, missing: true, finalMessage: null,
      stop: { kind: "cgroup_empty" as const, identity: { bootId: "00000000-0000-4000-8000-000000000001", invocationId: "a".repeat(32), unit: invalid === "unit" ? `chrona-executor-${"0".repeat(64)}.service` : unit, controlGroup: "/fixture" }, observer: "systemd_tracked" as const, populated: 0 as const, observedAt: new Date().toISOString(), observationDigest: "a".repeat(64) } };
    let who = f.who;
    if (invalid === "drain") { await f.auth.revoke({ workspaceId: f.principal.workspaceId, ownerId: f.principal.ownerId }, { executorId: f.fence.executorId, generation: 1, commandKey: "revoke" }); who = await f.auth.authenticate(f.credential, f.fence, "drain"); }
    const operation = f.control.controller.final(who, { ...f.request(), digest: await executorDigest(final), final }, AbortSignal.timeout(5000));
    if (invalid === "source" || invalid === "watermark") await expect(operation).rejects.toMatchObject({ code: "conflict" }); else expect((await operation).stopConfirmed).toBe(false);
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: f.a.id } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: "original-hold" });
    expect((await f.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: f.a.id } })).processIdentity).toBeNull();
  } finally { await f.db.$disconnect(); }
});
