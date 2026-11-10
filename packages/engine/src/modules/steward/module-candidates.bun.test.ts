import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { Caller } from "./module-calls";
import { admitCandidates, candidateSource, checkCandidates, submitCandidates } from "./module-candidates";
import { moduleContext } from "./module-context";
import { advanceFixedCandidateSet, activateGroupIn, recordGroupReview } from "./module-group";
import { createApprovals } from "./approvals";
import { buildPending } from "./module-build";
import { testModuleSandbox } from "./module-test-process";
import { findCandidateSet, assertCandidateSetIn } from "./module-candidate-records";
import { commitModuleSource } from "./module-git";
import { testDb } from "./test-db";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const owner: Caller = { kind: "owner", via: null };
const hash = "a".repeat(40);
const manifest = (name: string, uses: string[] = []) => moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, uses, effects: [] });
async function fixture(names = ["alpha", "beta"]) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-candidates-"));
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "candidate fixture" } });
  const author = await db.module.create({ data: { workspaceId: workspace.id, name: "author", activeHash: hash } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash, manifest: manifest("author", ["*"]), intent: {}, report: {}, source: "user", status: "approved" } });
  const caller: Caller = { kind: "module", module: "author", moduleId: author.id, hash };
  const ports = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-08T12:00:00Z") };
  const context = moduleContext(ports, workspace.id);
  const root = join(dataDir, "platform", "content", author.id);
  await mkdir(root, { recursive: true });
  for (const name of names) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "module.json"), JSON.stringify(manifest(name)));
    await writeFile(join(root, name, "index.ts"), 'import { on } from "chrona"; on("tool", () => ({ result: {} }));');
    await writeFile(join(root, name, "test.ts"), "export {};");
  }
  const input = { requestKey: "admit-1", submitter: { moduleId: author.id, hash }, targets: names.map(name => ({ name, moduleId: null, expectedActiveHash: null })) };
  const admission = await admitCandidates(ports, workspace.id, owner, input);
  const submission = { admissionId: admission.admissionId, requestKey: "submit-1", items: names.map(name => ({ name, dir: name, intent: { changes: ["Add fixture"], preserves: [] } })) };
  return { db, dataDir, ports, workspace, author, caller, context, root, input, admission, submission };
}

test("one transaction publishes all building versions, exact bindings and a bounded durable receipt", async () => {
  const f = await fixture();
  const receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  expect(receipt.state).toBe("submitted");
  expect(receipt.members).toHaveLength(2);
  expect(await f.db.moduleVersion.count({ where: { source: "candidate", status: "building" } })).toBe(2);
  for (const member of receipt.members) {
    const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } });
    expect((await findCandidateSet(f.context, version))?.receiptId).toBe(receipt.receiptId);
  }
  expect(JSON.stringify(receipt)).not.toContain(f.dataDir);
  expect(await checkCandidates(f.ports, f.workspace.id, f.caller, { admissionId: receipt.admissionId, requestKey: receipt.requestKey })).toEqual(receipt);
  expect(await checkCandidates(f.ports, f.workspace.id, owner, { receiptId: receipt.receiptId })).toEqual(receipt);
});

test("lost reply replay returns original immutable receipt without rereading changed or removed files", async () => {
  const f = await fixture(), original = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  await rm(join(f.root, "alpha"), { recursive: true });
  expect(await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission)).toEqual(original);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, items: [...f.submission.items].reverse() })).rejects.toMatchObject({ code: "conflict" });
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, requestKey: "second-key" })).rejects.toMatchObject({ code: "conflict" });
  await expect(checkCandidates(f.ports, f.workspace.id, f.caller, { admissionId: original.admissionId, requestKey: "wrong-key" })).rejects.toMatchObject({ code: "conflict" });
  await f.db.moduleVersion.updateMany({ where: { source: "candidate" }, data: { status: "rejected" } });
  expect((await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission)).state).toBe("rejected");
  expect(await f.db.moduleVersion.count({ where: { source: "candidate", status: "building" } })).toBe(0);
});

test("admission is owner-only, exact, idempotent and forbids Agent", async () => {
  const f = await fixture(["alpha"]);
  expect(await admitCandidates(f.ports, f.workspace.id, owner, f.input)).toEqual(f.admission);
  await expect(admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, targets: [{ name: "beta", moduleId: null, expectedActiveHash: null }] })).rejects.toMatchObject({ code: "conflict" });
  await expect(admitCandidates(f.ports, f.workspace.id, { kind: "provider", runId: "forged" }, { ...f.input, requestKey: "bad" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, requestKey: "agent", targets: [{ name: "agent", moduleId: null, expectedActiveHash: null }] })).rejects.toMatchObject({ code: "forbidden" });
  await expect(admitCandidates(f.ports, f.workspace.id, { ...f.caller, hash: "b".repeat(40) } as Caller, { ...f.input, requestKey: "stale-owner" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(admitCandidates(f.ports, "missing-workspace", owner, f.input)).rejects.toMatchObject({ code: "forbidden" });
  const agent = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "agent", builtin: true, activeHash: hash } });
  await f.db.moduleVersion.create({ data: { moduleId: agent.id, hash, manifest: manifest("agent", ["*"]), intent: {}, report: {}, source: "user", status: "approved" } });
  await expect(admitCandidates(f.ports, f.workspace.id, { kind: "module", module: "agent", moduleId: agent.id, hash }, { ...f.input, requestKey: "agent-issuer" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, requestKey: "agent-submitter", submitter: { moduleId: agent.id, hash } })).rejects.toMatchObject({ code: "forbidden" });
});

test("forged, stale and cross-workspace submitters cannot submit or read a fixed receipt", async () => {
  const f = await fixture(["alpha"]);
  for (const caller of [{ ...f.caller, module: "other" }, { ...f.caller, hash: "b".repeat(40) }, owner, { kind: "kernel" }]) await expect(submitCandidates(f.ports, f.workspace.id, caller as Caller, f.submission)).rejects.toMatchObject({ code: "forbidden" });
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await expect(submitCandidates(f.ports, other.id, f.caller, f.submission)).rejects.toMatchObject({ code: "not_found" });
  const receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  await f.db.module.update({ where: { id: f.author.id }, data: { activeHash: "b".repeat(40) } });
  await expect(checkCandidates(f.ports, f.workspace.id, f.caller, { receiptId: receipt.receiptId })).rejects.toMatchObject({ code: "forbidden" });
  await expect(checkCandidates(f.ports, other.id, owner, { receiptId: receipt.receiptId })).rejects.toMatchObject({ code: "not_found" });
});

test("target name drift and partial submissions leave no runnable versions or receipt", async () => {
  const f = await fixture();
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, items: f.submission.items.slice(0, 1) })).rejects.toMatchObject({ code: "conflict" });
  await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "beta" } });
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, f.submission)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
  expect(await f.db.candidateReceipt.count()).toBe(0);
  expect(await f.db.module.count({ where: { name: "alpha" } })).toBe(0);
});

test("all snapshots must be valid before any candidate is published; traversal and symlinks fail closed", async () => {
  const f = await fixture();
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, items: f.submission.items.map(item => ({ ...item, dir: "../" + item.dir })) })).rejects.toMatchObject({ code: "invalid" });
  await rm(join(f.root, "beta", "index.ts"));
  await symlink(join(f.root, "alpha", "index.ts"), join(f.root, "beta", "index.ts"));
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, f.submission)).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
});

async function sourceFixture() {
  const f = await fixture(["alpha"]);
  const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "existing" } });
  const files = [{ path: "module.json", bytes: Buffer.from(JSON.stringify(manifest("existing"))) }, { path: "index.ts", bytes: Buffer.from("export const existing = true;") }];
  const revision = await commitModuleSource({ platform: f.context.platform, moduleId: module.id, versionId: "baseline", files, message: "baseline fixture" });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: revision.commit, manifest: manifest("existing"), intent: {}, report: { git: revision }, source: "user", status: "approved" } });
  await f.db.module.update({ where: { id: module.id }, data: { activeHash: revision.commit } });
  const admission = await admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, requestKey: "source-admission", targets: [{ name: "existing", moduleId: module.id, expectedActiveHash: revision.commit }] });
  return { ...f, module, revision, source: { admissionId: admission.admissionId, moduleId: module.id, hash: revision.commit, to: "exported" } };
}

test("source exports only admitted exact baseline into caller content and refuses traversal, symlink and overwrite", async () => {
  const f = await sourceFixture();
  const result = await candidateSource(f.ports, f.workspace.id, f.caller, f.source);
  expect(result).toMatchObject({ moduleId: f.module.id, hash: f.revision.commit });
  expect(await readFile(join(f.root, "exported", "index.ts"), "utf8")).toContain("existing");
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, f.source)).rejects.toMatchObject({ code: "conflict" });
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, { ...f.source, to: "../escape" })).rejects.toMatchObject({ code: "invalid" });
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, { ...f.source, hash, to: "wrong" })).rejects.toMatchObject({ code: "forbidden" });
  await symlink(f.dataDir, join(f.root, "link"));
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, { ...f.source, to: "link/escape" })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: hash } });
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, { ...f.source, to: "drift" })).rejects.toMatchObject({ code: "conflict" });
});

test("an owner module grant is fenced again after its wildcard authority is revoked", async () => {
  const f = await fixture(["alpha"]);
  const admission = await admitCandidates(f.ports, f.workspace.id, f.caller, { ...f.input, requestKey: "module-owner-grant" });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.author.id, hash } }, data: { manifest: manifest("author") } });
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, admissionId: admission.admissionId })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
});

test("canonical caller content cannot be replaced by a symlink", async () => {
  const f = await fixture(["alpha"]);
  await rm(f.root, { recursive: true });
  await symlink(f.dataDir, f.root);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, f.submission)).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
});

test("existing target baseline drift rejects the whole submission before publication", async () => {
  const f = await sourceFixture();
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: hash } });
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, admissionId: f.source.admissionId, items: [{ ...f.submission.items[0]!, name: "existing" }] })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
});

async function reviewMember(f: Awaited<ReturnType<typeof fixture>>, member: { versionId: string }, needsMigration = false) {
  const version = await f.db.moduleVersion.update({ where: { id: member.versionId }, data: { status: "pending_review" } });
  expect(await recordGroupReview(f.context, version, { prefix: "Candidate review", suffix: "", codeDiff: "", detail: "Review fixture", needsMigration })).toBe(true);
  return advanceFixedCandidateSet(f.context, version);
}

test("a fixed set waits for every exact review then activates every member in one generation", async () => {
  const f = await fixture(), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  expect((await reviewMember(f, receipt.members[0]!))?.state).toBe("submitted");
  expect(await f.db.module.count({ where: { id: { in: receipt.members.map(member => member.moduleId) }, activeHash: { not: null } } })).toBe(0);
  expect((await reviewMember(f, receipt.members[1]!))?.state).toBe("approved");
  expect(await f.db.generation.count()).toBe(1);
  expect((await checkCandidates(f.ports, f.workspace.id, f.caller, { receiptId: receipt.receiptId })).members.every(member => member.selected && member.status === "approved")).toBe(true);
});

test("one failed member rejects every waiting member without partial activation or resurrection", async () => {
  const f = await fixture(), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  await reviewMember(f, receipt.members[0]!);
  const failed = await f.db.moduleVersion.update({ where: { id: receipt.members[1]!.versionId }, data: { status: "rejected" } });
  expect((await advanceFixedCandidateSet(f.context, failed))?.state).toBe("rejected");
  expect(await f.db.moduleVersion.count({ where: { source: "candidate", status: "rejected" } })).toBe(2);
  expect(await f.db.generation.count()).toBe(0);
  expect((await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission)).state).toBe("rejected");
});

test.each(["baseline", "submitter", "issuer"])("fixed credential approval rechecks %s drift and activates none", async drift => {
  const f = await fixture();
  // Bind an owner-module issuer so revocation is distinct from submitter identity drift.
  const issuer = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "issuer", activeHash: hash } });
  await f.db.moduleVersion.create({ data: { moduleId: issuer.id, hash, manifest: manifest("issuer", ["*"]), intent: {}, report: {}, source: "user", status: "approved" } });
  const admission = await admitCandidates(f.ports, f.workspace.id, { kind: "module", module: "issuer", moduleId: issuer.id, hash }, { ...f.input, requestKey: "credential-admission" });
  await writeFile(join(f.root, "beta", "module.json"), JSON.stringify({ ...manifest("beta"), secrets: [{ name: "mail", label: "Mail", fields: [], oauth: { provider: "google", authorizationUrl: "https://mail.example.test/authorize", tokenUrl: "https://mail.example.test/token", scopes: ["mail.read"] } }] }));
  const receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, admissionId: admission.admissionId });
  await reviewMember(f, receipt.members[0]!);
  const set = await reviewMember(f, receipt.members[1]!);
  expect(set?.state).toBe("pending_approval");
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: set!.approvalId! } });
  await createApprovals(f.context).resolve(approval.id, { decision: "approve", scope: "once" });
  if (drift === "baseline") await f.db.module.update({ where: { id: receipt.members[1]!.moduleId }, data: { activeHash: "c".repeat(40) } });
  if (drift === "submitter") await f.db.module.update({ where: { id: f.author.id }, data: { status: "paused" } });
  if (drift === "issuer") await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: issuer.id, hash } }, data: { manifest: manifest("issuer") } });
  await f.db.$transaction(tx => activateGroupIn(f.context, tx, { workspaceId: f.workspace.id, approvalId: approval.id, payload: approval.payload }));
  expect(await f.db.moduleVersion.count({ where: { source: "candidate", status: "approved" } })).toBe(0);
  expect(await f.db.generation.count()).toBe(0);
  expect((await checkCandidates(f.ports, f.workspace.id, owner, { receiptId: receipt.receiptId })).state).toBe("rejected");
});

test("a missing durable member binding fails closed instead of becoming a standalone candidate", async () => {
  const f = await fixture(["alpha"]), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: receipt.members[0]!.versionId } });
  await f.db.candidateMember.delete({ where: { versionId: version.id } });
  await expect(findCandidateSet(f.context, version)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.generation.count()).toBe(0);
});

test.each([false, true])("the real build queue checks frozen fixed material with a fake runtime (failure=%s)", async failSecond => {
  const f = await fixture(), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  let runs = 0;
  const sandbox = testModuleSandbox(async input => {
    runs++;
    expect(input.network).toBe(false);
    const candidateManifest = JSON.parse(await readFile(join(input.codeDir, "module.json"), "utf8")) as { name: string };
    const failed = failSecond && candidateManifest.name === "beta";
    return { status: failed ? "failed" : "succeeded", output: '{"effects":[]}', error: failed ? "fixture failed" : null, exitCode: failed ? 1 : 0 };
  });
  // The checker must consume the Git snapshot, even after application edits disappear.
  await rm(f.root, { recursive: true });
  await buildPending(moduleContext({ ...f.ports, sandbox }, f.workspace.id));
  const result = await checkCandidates(f.ports, f.workspace.id, f.caller, { receiptId: receipt.receiptId });
  expect(runs).toBe(2);
  expect(result.state).toBe(failSecond ? "rejected" : "approved");
  expect(result.members.every(member => member.selected === !failSecond)).toBe(true);
  expect(await f.db.generation.count()).toBe(failSecond ? 0 : 1);
});

test("final set fence rejects baseline and submitter drift", async () => {
  const f = await fixture(["alpha"]), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: receipt.members[0]!.versionId } });
  const set = (await findCandidateSet(f.context, version))!;
  await f.db.$transaction(tx => assertCandidateSetIn(f.context, tx, set));
  await f.db.module.update({ where: { id: receipt.members[0]!.moduleId }, data: { activeHash: hash } });
  await expect(f.db.$transaction(tx => assertCandidateSetIn(f.context, tx, set))).rejects.toMatchObject({ code: "conflict" });
  await f.db.module.update({ where: { id: receipt.members[0]!.moduleId }, data: { activeHash: null } });
  await f.db.module.update({ where: { id: f.author.id }, data: { status: "paused" } });
  await expect(f.db.$transaction(tx => assertCandidateSetIn(f.context, tx, set))).rejects.toMatchObject({ code: "forbidden" });
});
