import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { onApproved } from "./module-activation";
import { createApprovals } from "../approvals";
import type { StewardPorts } from "../ports";
import type { Caller } from "./module-calls";
import { admitCandidates, checkCandidates, submitCandidates } from "./module-candidates";
import { moduleContext } from "./module-context";
import { buildPending } from "./module-build";
import { storeVersionMaterial } from "./module-artifacts";
import { seedTestModuleRelease } from "../__testing__/module-release-test-fixture";
import { testModuleSandbox } from "../__testing__/module-test-process";
import { createRuns } from "../execution/runs";
import { testDb } from "../__testing__/test-db";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const authorHash = "a".repeat(64);
const manifest = (name: string, authority?: "owner", migration = false) => moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], authority, data: { schema: migration ? 2 : 1, ...(migration ? { migrate: "migrate.ts" } : {}) } });
async function fixture(migration = false, capability = true) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-fixed-recovery-"));
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "fixed recovery" } });
  const author = await db.module.create({ data: { workspaceId: workspace.id, name: "author", activeHash: authorHash } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash: authorHash, manifest: manifest("author", "owner"), intent: {}, report: {}, source: "user", status: "approved" } });
  const caller: Caller = { kind: "module", module: "author", moduleId: author.id, hash: authorHash };
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-08T12:00:00Z"), sandbox: testModuleSandbox(async () => ({ status: "succeeded", exitCode: 0, output: "{}", error: null })) };
  const context = moduleContext(ports, workspace.id);
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "alpha", dataSchema: 1 } });
  const baselineFiles = [{ path: "module.json", bytes: Buffer.from(JSON.stringify(manifest("alpha"))) }, { path: "index.ts", bytes: Buffer.from("export {};") }];
  baselineFiles.push({ path: "chrona-material.json", bytes: Buffer.from(JSON.stringify({ schema: 1, source: baselineFiles.map(file => file.path), artifacts: [], build: { commands: [], toolchain: "interpreted fixture", target: "host" } })) });
  const baselineHash = await storeVersionMaterial(context.platform, baselineFiles);
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: baselineHash, manifest: manifest("alpha"), intent: { changes: ["baseline"] }, report: {}, source: "user", status: "approved" } });
  await db.module.update({ where: { id: module.id }, data: { activeHash: baselineHash } });
  const dir = join(context.platform, "content", author.id, "alpha");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "module.json"), JSON.stringify(manifest("alpha", capability ? "owner" : undefined, migration)));
  await writeFile(join(dir, "index.ts"), "export const candidate = true;");
  await writeFile(join(dir, "test.ts"), "throw new Error('application test must not run');");
  if (migration) {
    await writeFile(join(dir, "migrate.ts"), "export {};");
    await mkdir(join(context.platform, "data", module.id), { recursive: true });
    await writeFile(join(context.platform, "data", module.id, "state"), "original");
  }
  await seedTestModuleRelease(join(context.platform, "content", author.id), "alpha");
  const admission = await admitCandidates(ports, workspace.id, caller, { requestKey: "admit", submitter: { moduleId: author.id, hash: authorHash }, target: { name: "alpha", moduleId: module.id, expectedActiveHash: baselineHash } });
  const receipt = await submitCandidates(ports, workspace.id, caller, { admissionId: admission.admissionId, requestKey: "submit", item: { name: "alpha", dir: "alpha", intent: { changes: ["fixed change"], preserves: [] } } });
  const check = () => checkCandidates(ports, workspace.id, caller, { receiptId: receipt.receiptId });
  return { db, ports, workspace, author, caller, context, module, baselineHash, receipt, check };
}

async function approvalFixture(migration = false) {
  const f = await fixture(migration);
  await buildPending(f.context);
  const receipt = await f.check();
  expect(receipt.state).toBe("pending_approval");
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: receipt.approvalId! } });
  const approvals = createApprovals(f.context, action => onApproved(f.context, action));
  return { ...f, approval, approvals };
}

test("fixed review and activation recover using the ordinary single-version path", async () => {
  const f = await approvalFixture();
  expect(f.approval).toMatchObject({ moduleId: f.module.id, payload: { kind: "activate_module", moduleId: f.module.id, hash: f.receipt.member.hash } });
  await f.db.approval.update({ where: { id: f.approval.id }, data: { status: "approved", resolvedAt: f.ports.now() } });
  await buildPending(f.context);
  expect(await f.check()).toMatchObject({ state: "approved", member: { selected: true } });
  await buildPending(f.context);
  expect((await f.check()).member.selected).toBe(true);
});

test.each(["baseline", "submitter", "issuer", "digest"])("approval rechecks fixed facts after review (%s)", async kind => {
  const f = await approvalFixture();
  if (kind === "baseline") await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "changed" } });
  if (kind === "submitter") await f.db.module.update({ where: { id: f.author.id }, data: { activeHash: "changed" } });
  if (kind === "issuer") await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.author.id, hash: authorHash } }, data: { manifest: manifest("author") } });
  if (kind === "digest") {
    const { status: _status, selected: _selected, ...member } = f.receipt.member;
    await f.db.candidateReceipt.update({ where: { id: f.receipt.receiptId }, data: { members: [{ ...member, materialDigest: "0".repeat(64) }] } });
  }
  await expect(f.approvals.resolve(f.approval.id, { decision: "approve" }, "test")).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).not.toBe(f.receipt.member.hash);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).executionFenceAt).toBeNull();
});

test("a different approval cannot consume the fixed receipt", async () => {
  const f = await approvalFixture();
  const other = await f.approvals.create({ moduleId: f.module.id, action: "activate_module", title: "Other", detail: "", preview: "", payload: f.approval.payload });
  await expect(f.approvals.resolve(other.id, { decision: "approve" }, "test")).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe(f.baselineHash);
});

test.each(["deny", "expire"] as const)("denied or expired fixed approval remains terminal (%s)", async kind => {
  const f = await approvalFixture();
  if (kind === "deny") await f.approvals.resolve(f.approval.id, { decision: "deny" }, "test");
  else await f.db.approval.update({ where: { id: f.approval.id }, data: { status: "expired" } });
  await buildPending(f.context);
  expect(await f.check()).toMatchObject({ state: "rejected", member: { selected: false } });
  await buildPending(f.context);
  expect(await f.db.approval.count()).toBe(1);
});

test("fixed migration runs only after approval and retains original data until then", async () => {
  const f = await approvalFixture(true), entries: string[] = [];
  f.ports.sandbox = { ...f.ports.sandbox!, runModule: async input => { entries.push(String(input.entry)); return { status: "succeeded", exitCode: 0, output: "{}", error: null }; } };
  const live = join(f.context.platform, "data", f.module.id, "state");
  expect(await readFile(live, "utf8")).toBe("original");
  await f.approvals.resolve(f.approval.id, { decision: "approve" }, "test");
  await buildPending(f.context);
  expect(entries).toEqual(["migrate.ts"]);
  expect(await f.check()).toMatchObject({ state: "approved", member: { selected: true } });
});

test("automatic fixed activation waits for unknown Agent stop and resumes the same receipt after actual stop", async () => {
  const f = await fixture(false, false);
  const session = await f.db.agentContext.create({ data: { workspaceId: f.workspace.id, ownerId: "owner", moduleId: f.module.id, hash: f.baselineHash } });

  const run = await f.db.run.create({ data: { workspaceId: f.workspace.id, sessionId: session.id, lane: "background", trigger: "module", provider: "fixture", tokenHash: crypto.randomUUID(), prompt: "offline", cwd: f.ports.dataDir, status: "running", startedAt: f.ports.now() } });
  const runs = createRuns(f.ports, f.workspace.id);
  await f.db.providerLaunch.create({ data: { runId: run.id, digest: "lost-observer-launch" } });
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: null });
  await buildPending(f.context);
  expect(await f.check()).toMatchObject({ state: "submitted", member: { status: "pending_review", selected: false } });
  expect((await f.db.run.findUniqueOrThrow({ where: { id: run.id } })).stopStatus).toBe("unknown");
  await runs.finish(run.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
  await buildPending(f.context);
  expect(await f.check()).toMatchObject({ state: "approved", member: { selected: true } });
});
