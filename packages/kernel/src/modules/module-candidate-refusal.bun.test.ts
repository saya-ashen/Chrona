import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { admitCandidates, checkCandidates, submitCandidates } from "./module-candidates";
import { callSync, registerSystemModule, type Caller } from "./module-calls";
import { modules } from "../system/modules";
import { ModuleSnapshot } from "./module-files";
import { withAgentContextEntry } from "../agent/agent-context-entry";
import { interruptRunCallsIn } from "../execution/run-events";
import { testDb } from "../__testing__/test-db";

registerSystemModule(modules);
const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const owner: Caller = { kind: "owner", via: null }, hash = "a".repeat(64);
const manifest = (name: string, authority?: "owner") => moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], authority });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-candidate-refusal-");
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "candidate refusal" } });
  const author = await db.module.create({ data: { workspaceId: workspace.id, name: "author", activeHash: hash } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash, manifest: manifest("author", "owner"), intent: {}, report: {}, source: "user", status: "approved" } });
  const caller: Caller = { kind: "module", module: "author", moduleId: author.id, hash };
  const ports = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-08T12:00:00Z") };
  const root = join(dataDir, "platform", "content", author.id, "alpha");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "module.json"), JSON.stringify(manifest("alpha")));
  await writeFile(join(root, "index.ts"), "export {};");
  await writeFile(join(root, "chrona-material.json"), JSON.stringify({ schema: 1, source: ["module.json", "index.ts"], artifacts: [], build: { commands: [], toolchain: "bun", target: "test" } }));
  const admission = await admitCandidates(ports, workspace.id, caller, { requestKey: "admit", submitter: { moduleId: author.id, hash }, target: { name: "alpha", moduleId: null, expectedActiveHash: null } });
  const submission = { admissionId: admission.admissionId, requestKey: "submit", item: { name: "alpha", dir: "alpha", intent: { changes: ["Fixture"], preserves: [] } } };
  const direct = () => submitCandidates(ports, workspace.id, caller, submission);
  const routed = (key = submission.requestKey, item = submission.item) => callSync(ports, { workspaceId: workspace.id, caller, chain: [], path: [] }, "modules.submit", { admissionId: admission.admissionId, item }, { key });
  const issuerAuthority = (authority?: "owner") => db.moduleVersion.update({ where: { moduleId_hash: { moduleId: author.id, hash } }, data: { manifest: manifest("author", authority) } });
  const revokeIssuer = () => issuerAuthority();
  return { db, ports, workspace, caller, root, submission, direct, routed, revokeIssuer, issuerAuthority };
}
async function refusal(operation: Promise<unknown>) {
  const result = await operation.then(value => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
  expect(result.error).toBeInstanceOf(Error);
  return result.error as Error & { code: string; reason?: string };
}
function pauseFirstSnapshot() {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const verify = ModuleSnapshot.prototype.verify;
  let first = true;
  const spy = spyOn(ModuleSnapshot.prototype, "verify").mockImplementation(async function (this: ModuleSnapshot) {
    await verify.call(this);
    if (first) { first = false; entered(); await gate; }
  });
  closes.push(async () => { release(); spy.mockRestore(); });
  return { ready, release };
}

test.each(["material", "authority"])("fresh routed %s refusal carries durable invocation proof", async kind => {
  const f = await fixture();
  if (kind === "material") await writeFile(join(f.root, "module.json"), "invalid json");
  else await f.revokeIssuer();
  const directError = await refusal(f.direct());
  expect(directError).toMatchObject({ code: kind === "material" ? "invalid" : "forbidden" });
  expect(directError.reason).toBeUndefined();
  expect(await refusal(f.routed())).toMatchObject({ code: kind === "material" ? "invalid" : "forbidden", reason: "submission_refused" });
  // Repairing the refusal cannot cause this keyed invocation to execute again.
  await writeFile(join(f.root, "module.json"), JSON.stringify(manifest("alpha")));
  await f.issuerAuthority("owner");
  expect(await refusal(f.routed())).toMatchObject({ reason: "submission_refused" });
  // Publication depends on persisted ownership, even through another client wrapper.
  const restartedPorts = { ...f.ports, db: new Proxy(f.db, {}) };
  const retry = await refusal(submitCandidates(restartedPorts, f.workspace.id, f.caller, f.submission));
  expect(retry).toMatchObject({ code: "conflict" });
  expect(retry.reason).toBeUndefined();
  await expect(checkCandidates(f.ports, f.workspace.id, owner, { admissionId: f.submission.admissionId, requestKey: "submit" })).rejects.toMatchObject({ code: "not_found" });
});

test("accepted receipt replay with stale issuer authority never carries refusal proof", async () => {
  const f = await fixture(), receipt = await f.direct();
  await f.revokeIssuer();
  expect(await refusal(f.routed())).toMatchObject({ code: "forbidden" });
  expect((await refusal(f.routed())).reason).toBeUndefined();
  expect((await checkCandidates(f.ports, f.workspace.id, owner, { receiptId: receipt.receiptId })).receiptId).toBe(receipt.receiptId);
});

test("submission conflicts never carry refusal proof", async () => {
  const f = await fixture();
  const partial = await refusal(f.routed("partial", { ...f.submission.item, name: "other" }));
  expect(partial).toMatchObject({ code: "conflict" });
  expect(partial.reason).toBeUndefined();
  await f.direct();
  const changed = await refusal(f.routed("submit", { ...f.submission.item, dir: "changed" }));
  expect(changed).toMatchObject({ code: "conflict" });
  expect(changed.reason).toBeUndefined();
});

test("raw material I/O errors are unmarked after public error translation", async () => {
  const f = await fixture();
  await rm(f.root, { recursive: true });
  const error = await refusal(f.routed());
  expect(error).toMatchObject({ code: "not_found" });
  expect(error.reason).toBeUndefined();
});

test("database failure before publication does not become refusal proof", async () => {
  const f = await fixture();
  const faultyDb = f.db.$extends({ query: { candidateAdmission: { findFirst() { throw new Error("injected database failure"); } } } });
  const error = await refusal(callSync({ ...f.ports, db: faultyDb as typeof f.db }, { workspaceId: f.workspace.id, caller: f.caller, chain: [], path: [] }, "modules.submit", { admissionId: f.submission.admissionId, item: f.submission.item }, { key: "submit" }));
  expect(error).toMatchObject({ code: "unknown" });
  expect(error.reason).toBeUndefined();
});

test("fixed publication does not depend on a Git repository directory", async () => {
  const f = await fixture();
  await writeFile(join(f.ports.dataDir, "platform", "repos"), "unused legacy directory");
  await expect(f.routed()).resolves.toBeDefined();
  await expect(checkCandidates(f.ports, f.workspace.id, owner, { admissionId: f.submission.admissionId, requestKey: "submit" })).resolves.toBeDefined();
});

test("parallel direct material refusal carries no proof while the original call can still publish", async () => {
  const f = await fixture(), pause = pauseFirstSnapshot();
  const original = f.direct();
  await pause.ready;
  await writeFile(join(f.root, "module.json"), "invalid json");
  const error = await refusal(f.direct());
  expect(error).toMatchObject({ code: "invalid" });
  expect(error.reason).toBeUndefined();
  pause.release();
  expect((await original).state).toBe("submitted");
});

test("a running routed invocation excludes parallel direct publication of the same key", async () => {
  const f = await fixture(), pause = pauseFirstSnapshot();
  const original = f.routed();
  await pause.ready;
  const error = await refusal(f.direct());
  expect(error).toMatchObject({ code: "conflict" });
  expect(error.reason).toBeUndefined();
  pause.release();
  expect((await original).output).toMatchObject({ state: "submitted" });
});

test("a direct call already freezing cannot publish behind a routed refusal", async () => {
  const f = await fixture(), pause = pauseFirstSnapshot();
  const original = refusal(f.direct());
  await pause.ready;
  await writeFile(join(f.root, "module.json"), "invalid json");
  expect(await refusal(f.routed())).toMatchObject({ code: "invalid", reason: "submission_refused" });
  pause.release();
  const error = await original;
  expect(error).toMatchObject({ code: "conflict" });
  expect(error.reason).toBeUndefined();
  await expect(checkCandidates(f.ports, f.workspace.id, owner, { admissionId: f.submission.admissionId, requestKey: "submit" })).rejects.toMatchObject({ code: "not_found" });
});

test("parallel direct receipt followed by replay authority failure carries no proof", async () => {
  const f = await fixture(), pause = pauseFirstSnapshot();
  const original = refusal(f.direct());
  await pause.ready;
  const receipt = await f.direct();
  await f.revokeIssuer();
  pause.release();
  const error = await original;
  expect(error).toMatchObject({ code: "forbidden" });
  expect(error.reason).toBeUndefined();
  expect((await checkCandidates(f.ports, f.workspace.id, owner, { receiptId: receipt.receiptId })).receiptId).toBe(receipt.receiptId);
});

test("Run interruption retains publication ownership while the routed handler can still refuse", async () => {
  const f = await fixture(), pause = pauseFirstSnapshot();
  const run = await f.db.run.create({ data: { workspaceId: f.workspace.id, lane: "foreground", trigger: "source", provider: "fake", tokenHash: "candidate-refusal", prompt: "", cwd: "/tmp", status: "running" } });
  const origin = { workspaceId: f.workspace.id, caller: f.caller, chain: [], path: [], run: { executionRunId: run.id } };
  const original = refusal(withAgentContextEntry(f.ports, origin, () => callSync(f.ports, origin, "modules.submit", { admissionId: f.submission.admissionId, item: f.submission.item }, { key: "submit" })));
  await pause.ready;
  await f.db.$transaction(tx => interruptRunCallsIn(tx, run.id, f.ports.now()));
  const competitor = await refusal(f.direct());
  expect(competitor).toMatchObject({ code: "conflict" });
  expect(competitor.reason).toBeUndefined();
  await f.revokeIssuer();
  pause.release();
  expect(await original).toMatchObject({ code: "forbidden", reason: "submission_refused" });
  await expect(checkCandidates(f.ports, f.workspace.id, owner, { admissionId: f.submission.admissionId, requestKey: "submit" })).rejects.toMatchObject({ code: "not_found" });
});
