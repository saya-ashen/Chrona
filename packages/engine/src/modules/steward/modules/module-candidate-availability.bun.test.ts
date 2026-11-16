import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { PAUSED_MODULE_NAMES } from "./module-availability";
import { admitCandidates, candidateSource, submitCandidates } from "./module-candidates";
import { assertCandidateSetIn, candidateDigest, candidateRequestId, type CandidateAdmissionRecord, type CandidateSet } from "./module-candidate-records";
import { json, moduleContext } from "./module-context";
import type { Caller } from "./module-calls";
import { testDb } from "../test-db";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const owner: Caller = { kind: "owner", via: null };
const hash = "a".repeat(40);
async function fixture(submitterName = "author") {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-candidate-availability-");
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "paused candidates" } });
  const ports = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-08T12:00:00Z") };
  async function app(name: string) {
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: hash } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], uses: ["*"], effects: [],
        authority: "owner"
    });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    return module;
  }
  const submitter = await app(submitterName);
  const caller: Caller = { kind: "module", module: submitterName, moduleId: submitter.id, hash };
  const input = { requestKey: "admit", submitter: { moduleId: submitter.id, hash }, targets: [{ name: "ordinary", moduleId: null as string | null, expectedActiveHash: null as string | null }] };
  return { db, ports, workspace, submitter, caller, input, app, context: moduleContext(ports, workspace.id) };
}

// Persist the exact pre-policy record shape, without disabling or mocking the pause policy.
async function storedAdmission(f: Awaited<ReturnType<typeof fixture>>, target: { name: string; moduleId: string | null; expectedActiveHash: string | null }, issuer = owner) {
  const input = { ...f.input, targets: [target] };
  const admissionId = candidateRequestId("admission", f.workspace.id, issuer, input.requestKey);
  const admission: CandidateAdmissionRecord = { input, issuer, receiptId: null };
  await f.db.candidateAdmission.create({ data: { id: admissionId, workspaceId: f.workspace.id, requestKey: input.requestKey, submitterModuleId: input.submitter.moduleId, submitterHash: input.submitter.hash, targets: json(input.targets), issuer: json(issuer), createdAt: f.ports.now() } });
  const submission = { admissionId, requestKey: "submit", items: [{ name: target.name, dir: "missing-material", intent: { changes: ["Stored before pause"], preserves: [] } }] };
  return { input, admissionId, admission, submission };
}

async function storedReceipt(f: Awaited<ReturnType<typeof fixture>>, stored: Awaited<ReturnType<typeof storedAdmission>>) {
  const target = stored.input.targets[0]!;
  const module = target.moduleId ? await f.db.module.findUniqueOrThrow({ where: { id: target.moduleId } }) : await f.db.module.create({ data: { workspaceId: f.workspace.id, name: target.name } });
  const version = await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "b".repeat(40), manifest: moduleManifestSchema.parse({ name: target.name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] }), status: "building", source: "candidate", intent: {}, report: {} } });
  const receiptId = candidateRequestId("submission", f.workspace.id, f.caller, stored.submission.requestKey);
  const set: CandidateSet = { receiptId, admissionId: stored.admissionId, requestKey: stored.submission.requestKey, submitter: stored.input.submitter, members: [{ name: target.name, moduleId: module.id, versionId: version.id, hash: version.hash, expectedActiveHash: target.expectedActiveHash, materialDigest: "c".repeat(64) }], state: "submitted", approvalId: null };
  await f.db.candidateReceipt.create({ data: { id: receiptId, admissionId: stored.admissionId, requestKey: set.requestKey, requestDigest: candidateDigest(stored.submission), state: set.state, createdAt: f.ports.now(), members: json(set.members), memberBindings: { create: set.members.map(member => ({ versionId: member.versionId })) } } });
  return set;
}

const unavailable = { code: "unavailable", reason: "module_paused" };

test.each([...PAUSED_MODULE_NAMES])("new and installed %s targets cannot receive exact candidate admission", async name => {
  const f = await fixture();
  const target = { name, moduleId: null as string | null, expectedActiveHash: null as string | null };
  await expect(admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, targets: [target] })).rejects.toMatchObject(unavailable);
  expect(await f.db.module.count({ where: { name } })).toBe(0);
  const installed = await f.app(name);
  await expect(admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, targets: [{ ...target, moduleId: installed.id, expectedActiveHash: hash }] })).rejects.toMatchObject(unavailable);
  expect(await f.db.candidateAdmission.count()).toBe(0);
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
});

test.each([...PAUSED_MODULE_NAMES])("paused %s cannot submit or issue an exact candidate grant", async name => {
  const f = await fixture(name);
  await expect(admitCandidates(f.ports, f.workspace.id, owner, f.input)).rejects.toMatchObject(unavailable);
  const active = await f.app("active-author");
  await expect(admitCandidates(f.ports, f.workspace.id, f.caller, { ...f.input, submitter: { moduleId: active.id, hash } })).rejects.toMatchObject(unavailable);
  const stored = await storedAdmission(f, f.input.targets[0]!);
  await expect(admitCandidates(f.ports, f.workspace.id, owner, stored.input)).rejects.toMatchObject(unavailable);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, stored.submission)).rejects.toMatchObject(unavailable);
  const set = await storedReceipt(f, stored);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, stored.submission)).rejects.toMatchObject(unavailable);
  await expect(f.db.$transaction(tx => assertCandidateSetIn(f.context, tx, set))).rejects.toMatchObject(unavailable);
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(1);
  expect(await f.db.moduleVersion.count({ where: { source: "candidate", status: "approved" } })).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
});

test.each([...PAUSED_MODULE_NAMES])("stored %s admission, source export, receipt replay and activation fences stay unavailable", async name => {
  const f = await fixture(), target = await f.app(name);
  const stored = await storedAdmission(f, { name, moduleId: target.id, expectedActiveHash: hash });
  await expect(admitCandidates(f.ports, f.workspace.id, owner, stored.input)).rejects.toMatchObject(unavailable);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, stored.submission)).rejects.toMatchObject(unavailable);
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, { admissionId: stored.admissionId, moduleId: target.id, hash, to: "exported" })).rejects.toMatchObject(unavailable);
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
  const set = await storedReceipt(f, stored);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, stored.submission)).rejects.toMatchObject(unavailable);
  await expect(f.db.$transaction(tx => assertCandidateSetIn(f.context, tx, set))).rejects.toMatchObject(unavailable);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ activeHash: hash });
  expect(await f.db.moduleVersion.count({ where: { source: "candidate", status: "building" } })).toBe(1);
  expect(await f.db.candidateReceipt.count()).toBe(1);
  expect(await f.db.approval.count()).toBe(0);
});

test("a paused grant issuer cannot authorize replay by an otherwise active submitter", async () => {
  const f = await fixture(), issuer = await f.app("remind");
  const stored = await storedAdmission(f, f.input.targets[0]!, { kind: "module", module: issuer.name, moduleId: issuer.id, hash });
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, stored.submission)).rejects.toMatchObject(unavailable);
  const set = await storedReceipt(f, stored);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, stored.submission)).rejects.toMatchObject(unavailable);
  await expect(f.db.$transaction(tx => assertCandidateSetIn(f.context, tx, set))).rejects.toMatchObject(unavailable);
  expect(await f.db.approval.count()).toBe(0);
});
