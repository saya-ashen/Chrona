import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { onApproved } from "./module-activation";
import { createApprovals } from "../approvals";
import { createExecutionEventStore } from "../execution/execution-event-store";
import type { StewardPorts } from "../ports";
import type { Caller } from "./module-calls";
import { admitCandidates, submitCandidates } from "./module-candidates";
import { moduleContext } from "./module-context";
import { readCandidateSetIn } from "./module-candidate-records";
import { activateFixedCandidateApprovedIn, activateGroupIn, advanceFixedCandidateSet, recordGroupReview } from "./module-group";
import { createRuns } from "../execution/runs";
import { testDb } from "../__testing__/test-db";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const baseline = "a".repeat(40);
const manifest = (name: string, uses: string[] = []) => moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, uses, authority: uses.includes("*") ? "owner" : undefined, effects: [] });

async function fixture(count = 2, migration = false) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-fixed-recovery-"));
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "fixed recovery fixture" } });
  const author = await db.module.create({ data: { workspaceId: workspace.id, name: "author", activeHash: baseline } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash: baseline, manifest: manifest("author", ["*"]), intent: {}, report: {}, source: "user", status: "approved" } });
  // The same current module is both owner issuer and admitted submitter.
  const caller: Caller = { kind: "module", module: "author", moduleId: author.id, hash: baseline };
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-08T12:00:00Z") };
  ports.executionEvents = createExecutionEventStore(ports);
  const context = moduleContext(ports, workspace.id);
  const targets = [];
  for (const name of ["alpha", "beta"].slice(0, count)) {
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: baseline, dataSchema: 1 } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: baseline, manifest: manifest(name), intent: {}, report: {}, source: "user", status: "approved" } });
    const dir = join(dataDir, "platform", "content", author.id, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "module.json"), JSON.stringify({ ...manifest(name), ...(migration ? { data: { schema: 2, migrate: "migrate.ts" } } : {}), secrets: [{ name: "mail", label: "Mail", fields: [], oauth: { provider: "google", authorizationUrl: "https://mail.example.test/authorize", tokenUrl: "https://mail.example.test/token", scopes: ["mail.read"] } }] }));
    await writeFile(join(dir, "index.ts"), "export {};");
    await writeFile(join(dir, "test.ts"), "export {};");
    if (migration) await writeFile(join(dir, "migrate.ts"), "// offline migration fixture");
    targets.push({ name, moduleId: module.id, expectedActiveHash: baseline });
  }
  const admission = await admitCandidates(ports, workspace.id, caller, { requestKey: "admit", submitter: { moduleId: author.id, hash: baseline }, targets });
  const receipt = await submitCandidates(ports, workspace.id, caller, { admissionId: admission.admissionId, requestKey: "submit", items: targets.map(target => ({ name: target.name, dir: target.name, intent: { changes: ["Add credentials"], preserves: [] } })) });
  for (const member of receipt.members) {
    const version = await db.moduleVersion.update({ where: { id: member.versionId }, data: { status: "pending_review" } });
    await recordGroupReview(context, version, { prefix: "Reviewed fixed material", suffix: "", codeDiff: "", detail: "Offline fixture", needsMigration: migration });
  }
  const version = await db.moduleVersion.findUniqueOrThrow({ where: { id: receipt.members[0]!.versionId } });
  const set = await advanceFixedCandidateSet(context, version);
  expect(set?.state).toBe("pending_approval");
  const approval = await db.approval.findUniqueOrThrow({ where: { id: set!.approvalId! } });
  const activate = (action: { workspaceId: string; approvalId: string; payload: typeof approval.payload }) => db.$transaction(async tx => {
    if (count === 1) expect(await activateFixedCandidateApprovedIn(context, tx, action)).toBe(true);
    else await activateGroupIn(context, tx, action);
  });
  return { db, ports, context, workspace, author, receipt, version, approval, activate };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function blockExecution(f: Fixture, state: "queued" | "unknown", agent = false) {
  const moduleId = f.receipt.members.at(-1)!.moduleId;
  const session = await f.db.session.create({ data: { workspaceId: f.workspace.id, moduleId, source: "module", key: "execution-context" } });
  if (agent) await f.db.agentContext.create({ data: { sessionId: session.id, workspaceId: f.workspace.id, moduleId: moduleId, hash: "" } });
  const run = await f.db.run.create({ data: { workspaceId: f.workspace.id, sessionId: session.id, lane: "background", trigger: "source", provider: "fixture", tokenHash: crypto.randomUUID(), prompt: "fixture", cwd: f.ports.dataDir, status: state === "queued" ? "queued" : "running", startedAt: state === "unknown" ? f.ports.now() : null } });
  const attempt = agent ? null : await f.db.executionAttempt.create({ data: { workspaceId: f.workspace.id, ownerId: "owner", callerKey: `module:${moduleId}`, moduleId, callerHash: baseline, workId: "work", commandKey: "start", requestDigest: "fixture", runId: run.id, projectRef: "project", projectDigest: "fixture", logDir: join(f.ports.dataDir, "logs"), baseline: `commit:${baseline}`, budget: {}, heldDirectory: join(f.ports.dataDir, "occupied") } });
  const runs = createRuns(f.ports, f.workspace.id);
  if (state === "unknown") {
    await runs.finish(run.id, { outcome: "failed", sessionId: null, error: null });
    expect(await f.db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ stopStatus: "unknown", error: "Execution stop is unconfirmed" });
  }
  return {
    attempt,
    runId: run.id,
    stop: () => runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: state === "queued" ? "never_started" : "provider_exited" }),
  };
}
async function expectUnchanged(f: Fixture, status = "pending_review") {
  for (const member of f.receipt.members) {
    expect((await f.db.module.findUniqueOrThrow({ where: { id: member.moduleId } })).activeHash).toBe(baseline);
    expect((await f.db.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } })).status).toBe(status);
  }
  expect(await f.db.generation.count({ where: { workspaceId: f.workspace.id } })).toBe(0);
}

for (const count of [1, 2]) test.each(["queued", "unknown"] as const)(`${count} fixed candidates recover after %s cancellation or confirmed running stop`, async state => {
  const f = await fixture(count), blocked = await blockExecution(f, state);
  const approvals = createApprovals(f.context, f.activate);
  // resolve commits the approval before its activation callback encounters the execution guard.
  await expect(approvals.resolve(f.approval.id, { decision: "approve", scope: "once" })).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: f.approval.id } })).status).toBe("approved");
  const recovered = await advanceFixedCandidateSet(f.context, f.version);
  expect(recovered?.approvalId).toBe(f.approval.id);
  if (state === "queued") {
    expect(recovered?.state).toBe("approved");
    expect(await f.db.run.findUniqueOrThrow({ where: { id: blocked.runId } })).toMatchObject({ status: "cancelled", startedAt: null });
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: blocked.attempt!.id } })).toMatchObject({ stopConfirmedAt: f.ports.now(), stopEvidence: { kind: "never_started" }, heldDirectory: null });
  } else {
    expect(recovered?.state).toBe("pending_approval");
    await expectUnchanged(f);
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: blocked.attempt!.id } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: join(f.ports.dataDir, "occupied") });
    await blocked.stop();
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: blocked.attempt!.id } })).toMatchObject({ stopConfirmedAt: f.ports.now(), heldDirectory: null });
  }
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("approved");
  for (const member of f.receipt.members) {
    expect((await f.db.module.findUniqueOrThrow({ where: { id: member.moduleId } })).activeHash).toBe(member.hash);
    expect((await f.db.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } })).status).toBe("approved");
  }
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("approved");
  expect(await f.db.generation.count({ where: { workspaceId: f.workspace.id } })).toBe(1);
  expect(await f.db.approval.count({ where: { workspaceId: f.workspace.id } })).toBe(1);
});

test("an Agent context with an unknown stop also keeps approved fixed recovery pending", async () => {
  const f = await fixture(), blocked = await blockExecution(f, "unknown", true);
  await createApprovals(f.context).resolve(f.approval.id, { decision: "approve", scope: "once" });
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("pending_approval");
  await expectUnchanged(f);
  await blocked.stop();
  expect(await f.db.run.findUniqueOrThrow({ where: { id: blocked.runId } })).toMatchObject({ error: null });
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("approved");
});

test.each(["baseline", "submitter", "issuer", "binding", "subset", "duplicate", "hash", "workspace", "module", "action", "approval_id"] as const)("approved recovery rejects %s drift without activating any member", async drift => {
  const f = await fixture(), blocked = await blockExecution(f, "unknown");
  await createApprovals(f.context).resolve(f.approval.id, { decision: "approve", scope: "once" });
  const last = f.receipt.members[1]!;
  if (drift === "baseline") await f.db.module.update({ where: { id: last.moduleId }, data: { activeHash: "c".repeat(40) } });
  if (drift === "submitter") await f.db.module.update({ where: { id: f.author.id }, data: { status: "paused" } });
  if (drift === "issuer") await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.author.id, hash: baseline } }, data: { manifest: manifest("author") } });
  if (drift === "binding") await f.db.candidateMember.delete({ where: { versionId: last.versionId } });
  if (["subset", "duplicate", "hash"].includes(drift)) {
    const versions = f.receipt.members.map(member => ({ moduleId: member.moduleId, hash: member.hash }));
    if (drift === "subset") versions.pop();
    if (drift === "duplicate") versions[1] = versions[0]!;
    if (drift === "hash") versions[1]!.hash = baseline;
    await f.db.approval.update({ where: { id: f.approval.id }, data: { payload: { kind: "activate_modules", versions } } });
  }
  if (drift === "workspace") {
    const other = await f.db.workspace.create({ data: { name: "unrelated" } });
    await f.db.approval.update({ where: { id: f.approval.id }, data: { workspaceId: other.id } });
  }
  if (drift === "module") await f.db.approval.update({ where: { id: f.approval.id }, data: { moduleId: last.moduleId } });
  if (drift === "action") await f.db.approval.update({ where: { id: f.approval.id }, data: { action: "delete_data" } });
  if (drift === "approval_id") await f.db.approval.update({ where: { id: f.approval.id }, data: { id: "different-approval" } });
  // Permanent drift is rejected even before the temporary execution conflict clears.
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("rejected");
  await blocked.stop();
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("rejected");
  expect(await readCandidateSetIn(f.context, f.db, f.receipt.receiptId)).toMatchObject({ state: "rejected" });
  for (const member of f.receipt.members) {
    expect((await f.db.module.findUniqueOrThrow({ where: { id: member.moduleId } })).activeHash).toBe(drift === "baseline" && member === last ? "c".repeat(40) : baseline);
    expect((await f.db.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } })).status).toBe("rejected");
  }
  expect(await f.db.generation.count({ where: { workspaceId: f.workspace.id } })).toBe(0);
});

test.each(["restore", "extra", "hash", "baseline"] as const)("single approved recovery rejects %s drift", async drift => {
  const f = await fixture(1), blocked = await blockExecution(f, "unknown");
  await createApprovals(f.context).resolve(f.approval.id, { decision: "approve", scope: "once" });
  const member = f.receipt.members[0]!;
  if (drift === "baseline") await f.db.module.update({ where: { id: member.moduleId }, data: { activeHash: "c".repeat(40) } });
  else await f.db.approval.update({ where: { id: f.approval.id }, data: { payload: {
    kind: "activate_module", moduleId: member.moduleId, hash: drift === "hash" ? baseline : member.hash,
    ...(drift === "restore" ? { restore: true } : {}), ...(drift === "extra" ? { unrelated: true } : {}),
  } } });
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("rejected");
  await blocked.stop();
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("rejected");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: member.moduleId } })).activeHash).toBe(drift === "baseline" ? "c".repeat(40) : baseline);
  expect((await f.db.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } })).status).toBe("rejected");
  expect(await f.db.generation.count({ where: { workspaceId: f.workspace.id } })).toBe(0);
});

test("a late permanent activation conflict rolls back every approval and switch before rejecting the set", async () => {
  const f = await fixture();
  await createApprovals(f.context).resolve(f.approval.id, { decision: "approve", scope: "once" });
  const last = f.receipt.members[1]!;
  const candidate = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: last.versionId } });
  await f.db.moduleVersion.update({ where: { id: last.versionId }, data: { manifest: { ...moduleManifestSchema.parse(candidate.manifest), listen: "/api/recovery" } } });
  const occupied = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "occupied", activeHash: baseline } });
  await f.db.moduleVersion.create({ data: { moduleId: occupied.id, hash: baseline, manifest: { ...manifest("occupied"), listen: "/api/recovery" }, intent: {}, report: {}, source: "user", status: "approved" } });
  expect((await advanceFixedCandidateSet(f.context, f.version))?.state).toBe("rejected");
  await expectUnchanged(f, "rejected");
  expect(await f.db.audit.count({ where: { workspaceId: f.workspace.id, kind: "module_activate" } })).toBe(0);
});


test("a fixed single candidate uses the existing approved data migration and preserves its backup", async () => {
  const f = await fixture(1, true), member = f.receipt.members[0]!;
  const data = join(f.ports.dataDir, "platform/data", member.moduleId);
  await mkdir(data, { recursive: true }); await writeFile(join(data, "value"), "original");
  f.ports.sandbox = { available: true, isolated: true, async runModule(input) {
    await writeFile(join(input.dataDir, "value"), "migrated");
    return { status: "succeeded", output: "", exitCode: 0, error: null };
  } };
  const approvals = createApprovals({ db: f.db, workspaceId: f.workspace.id, now: f.ports.now }, action => onApproved(f.context, action));
  await approvals.resolve(f.approval.id, { decision: "approve" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: member.moduleId } })).toMatchObject({ activeHash: member.hash, dataSchema: 2, status: "active" });
  expect(await readFile(join(data, "value"), "utf8")).toBe("migrated");
  expect(await readFile(join(f.ports.dataDir, "platform/snapshots", member.moduleId, "schema-1", "value"), "utf8")).toBe("original");
});

for (const kind of ["agent", "control", "cleanup-reserved", "cleanup-unknown"] as const) test(`fixed activation waits for unresolved ${kind} after confirmed Run stop`, async () => {
  const f = await fixture(1), blocked = await blockExecution(f, "queued");
  await blocked.stop();
  const moduleId = f.receipt.members[0]!.moduleId;
  const approvals = createApprovals(f.context, f.activate);
  if (kind === "agent") await f.db.agentCommand.create({ data: { id: "unsettled", workspaceId: f.workspace.id, moduleId, hash: baseline, operation: "native", requestDigest: "fixture", output: {}, settled: false } });
  else await f.db.executionCommand.create({ data: { attemptId: blocked.attempt!.id, commandKey: "unsettled", operation: kind === "control" ? "send" : "workspace-cleanup-confirm", requestDigest: "fixture", effect: kind === "control" ? "unknown" : null, receipt: kind === "cleanup-unknown" ? { result: { state: "unknown" } } : {} } });
  await expect(approvals.resolve(f.approval.id, { decision: "approve" })).rejects.toMatchObject({ code: "conflict" });
  await expectUnchanged(f);
  if (kind === "agent") await f.db.agentCommand.update({ where: { id: "unsettled" }, data: { settled: true } });
  else await f.db.executionCommand.update({ where: { attemptId_commandKey: { attemptId: blocked.attempt!.id, commandKey: "unsettled" } }, data: { effect: "confirmed", receipt: kind === "control" ? {} : { result: { state: "removed" } } } });
  await approvals.resolve(f.approval.id, { decision: "approve" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: moduleId } })).toMatchObject({ activeHash: f.version.hash, executionFenceAt: null });
  expect(await f.db.approval.count()).toBe(1);
});
