import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { candidateAdmissionInputSchema, candidateSubmitInputSchema } from "../../../contracts/src/steward/module-candidates";
import type { Caller } from "./module-calls";
import { admitCandidates, candidateSource, checkCandidates, submitCandidates } from "./module-candidates";
import { moduleContext } from "./module-context";
import { assertCandidateSetIn, findCandidateSet } from "./module-candidate-records";
import { storeVersionMaterial } from "./module-artifacts";
import { seedTestModuleRelease } from "../__testing__/module-release-test-fixture";
import { buildPending } from "./module-build";
import { testModuleSandbox } from "../__testing__/module-test-process";
import { testDb } from "../__testing__/test-db";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const owner: Caller = { kind: "owner", via: null }, hash = "a".repeat(64);
const manifest = (name: string, authority?: "owner") => moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], authority });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-candidates-"));
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "candidate fixture" } });
  const author = await db.module.create({ data: { workspaceId: workspace.id, name: "author", activeHash: hash } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash, manifest: manifest("author", "owner"), intent: {}, report: {}, source: "user", status: "approved" } });
  const caller: Caller = { kind: "module", module: "author", moduleId: author.id, hash };
  const ports = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-08T12:00:00Z") };
  const context = moduleContext(ports, workspace.id), root = join(context.platform, "content", author.id);
  await mkdir(join(root, "alpha"), { recursive: true });
  await writeFile(join(root, "alpha/module.json"), JSON.stringify(manifest("alpha")));
  await writeFile(join(root, "alpha/index.ts"), "export {};");
  await writeFile(join(root, "alpha/test.ts"), "throw new Error('application test must not run during installation');");
  await seedTestModuleRelease(root, "alpha");
  const input = { requestKey: "admit-1", submitter: { moduleId: author.id, hash }, target: { name: "alpha", moduleId: null, expectedActiveHash: null } };
  const admission = await admitCandidates(ports, workspace.id, owner, input);
  const submission = { admissionId: admission.admissionId, requestKey: "submit-1", item: { name: "alpha", dir: "alpha", intent: { changes: ["Add fixture"], preserves: [] } } };
  return { db, dataDir, ports, workspace, author, caller, context, root, input, admission, submission };
}

test("single admission and submission reject plural inputs", async () => {
  const f = await fixture();
  expect(candidateAdmissionInputSchema.safeParse({ ...f.input, targets: [f.input.target] }).success).toBe(false);
  expect(candidateSubmitInputSchema.safeParse({ admissionId: f.admission.admissionId, requestKey: "old", items: [f.submission.item] }).success).toBe(false);
  expect(await admitCandidates(f.ports, f.workspace.id, owner, f.input)).toEqual(f.admission);
  await expect(admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, target: { ...f.input.target, name: "beta" } })).rejects.toMatchObject({ code: "conflict" });
});

test("one fixed receipt survives a lost reply and removed submitted files", async () => {
  const f = await fixture(), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  expect(receipt).toMatchObject({ state: "submitted", member: { name: "alpha", expectedActiveHash: null } });
  expect(receipt).not.toHaveProperty("members");
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: receipt.member.versionId } });
  expect((await findCandidateSet(f.context, version))?.receiptId).toBe(receipt.receiptId);
  await rm(join(f.root, "alpha"), { recursive: true });
  expect(await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission)).toEqual(receipt);
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, item: { ...f.submission.item, dir: "changed" } })).rejects.toMatchObject({ code: "conflict" });
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, requestKey: "new-key" })).rejects.toMatchObject({ code: "conflict" });
  expect(await checkCandidates(f.ports, f.workspace.id, owner, { receiptId: receipt.receiptId })).toEqual(receipt);
  await expect(checkCandidates(f.ports, f.workspace.id, f.caller, { admissionId: receipt.admissionId, requestKey: "wrong" })).rejects.toMatchObject({ code: "conflict" });
});

test("admission and receipt access require current exact caller and owner identities", async () => {
  const f = await fixture();
  await expect(admitCandidates(f.ports, f.workspace.id, { kind: "provider", runId: "forged" }, { ...f.input, requestKey: "bad" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, requestKey: "agent", target: { ...f.input.target, name: "agent" } })).rejects.toMatchObject({ code: "forbidden" });
  for (const caller of [owner, { ...f.caller, module: "other" }, { ...f.caller, hash: "b".repeat(64) }]) await expect(submitCandidates(f.ports, f.workspace.id, caller as Caller, f.submission)).rejects.toMatchObject({ code: "forbidden" });
  const receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await expect(checkCandidates(f.ports, other.id, owner, { receiptId: receipt.receiptId })).rejects.toMatchObject({ code: "not_found" });
  await f.db.module.update({ where: { id: f.author.id }, data: { activeHash: "b".repeat(64) } });
  await expect(checkCandidates(f.ports, f.workspace.id, f.caller, { receiptId: receipt.receiptId })).rejects.toMatchObject({ code: "forbidden" });
});

test.each(["name", "traversal", "symlink"])("invalid fixed material publishes nothing (%s)", async kind => {
  const f = await fixture();
  if (kind === "symlink") {
    await rm(join(f.root, "alpha/index.ts"));
    await symlink(join(f.root, "alpha/test.ts"), join(f.root, "alpha/index.ts"));
  }
  const item = { ...f.submission.item, ...(kind === "name" ? { name: "beta" } : kind === "traversal" ? { dir: "../alpha" } : {}) };
  await expect(submitCandidates(f.ports, f.workspace.id, f.caller, { ...f.submission, item })).rejects.toMatchObject({ code: kind === "name" ? "conflict" : kind === "traversal" ? "invalid" : "forbidden" });
  expect(await f.db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
  expect(await f.db.candidateReceipt.count()).toBe(0);
});

test("source exports only the admitted baseline and preserves an occupied destination", async () => {
  const f = await fixture();
  const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "existing" } });
  const files = [{ path: "module.json", bytes: Buffer.from(JSON.stringify(manifest("existing"))) }, { path: "index.ts", bytes: Buffer.from("export const existing = true;") }];
  files.push({ path: "chrona-material.json", bytes: Buffer.from(JSON.stringify({ schema: 1, source: files.map(file => file.path), artifacts: [], build: { commands: [], toolchain: "interpreted fixture", target: "host" } })) });
  const hash = await storeVersionMaterial(f.context.platform, files);
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: hash, manifest: manifest("existing"), intent: {}, report: {}, source: "user", status: "approved" } });
  await f.db.module.update({ where: { id: module.id }, data: { activeHash: hash } });
  const admission = await admitCandidates(f.ports, f.workspace.id, owner, { ...f.input, requestKey: "baseline", target: { name: "existing", moduleId: module.id, expectedActiveHash: hash } });
  const request = { admissionId: admission.admissionId, moduleId: module.id, hash: hash, to: "baseline" };
  expect(await candidateSource(f.ports, f.workspace.id, f.caller, request)).toMatchObject({ hash: hash, materialDigest: expect.any(String) });
  expect(await readFile(join(f.root, "baseline/index.ts"), "utf8")).toBe("export const existing = true;");
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, request)).rejects.toMatchObject({ code: "conflict" });
  await expect(candidateSource(f.ports, f.workspace.id, f.caller, { ...request, hash: "f".repeat(64), to: "other" })).rejects.toMatchObject({ code: "forbidden" });
});

test("fixed candidates use installation startup checks without running application tests", async () => {
  const f = await fixture(), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  let applicationRuns = 0;
  const ports = { ...f.ports, sandbox: testModuleSandbox(async () => { applicationRuns++; throw new Error("application tests must stay in the application repository"); }) };
  await buildPending(moduleContext(ports, f.workspace.id));
  expect(await checkCandidates(ports, f.workspace.id, f.caller, { receiptId: receipt.receiptId })).toMatchObject({ state: "approved", member: { selected: true } });
  expect(applicationRuns).toBe(0);
});

test("fixed baseline and missing version binding cannot become standalone activation", async () => {
  const f = await fixture(), receipt = await submitCandidates(f.ports, f.workspace.id, f.caller, f.submission);
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: receipt.member.versionId } });
  const set = (await findCandidateSet(f.context, version))!;
  await f.db.module.update({ where: { id: receipt.member.moduleId }, data: { activeHash: "changed" } });
  await expect(assertCandidateSetIn(f.context, f.db, set)).rejects.toMatchObject({ code: "conflict" });
  await f.db.candidateMember.deleteMany({ where: { versionId: version.id } });
  await expect(findCandidateSet(f.context, version)).rejects.toMatchObject({ code: "conflict" });
});
