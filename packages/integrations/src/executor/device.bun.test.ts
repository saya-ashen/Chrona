import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import fixture from "../../../contracts/fixtures/executor-v1/cases.json";
import { EXECUTOR_PROTOCOL, executorAssignmentSchema } from "@chrona/contracts/steward";
import { createExecutorClient, executorCredential } from "./client";
import { ExecutorJournal, assignmentUnit, localDigest } from "./journal";
import { ExecutorSpool } from "./spool";
import { localDirectoryIdentity, prepareLockedLocalWorkspace, verifyLocalSource } from "./workspaces";

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), "chrona-device-test-")));
test("fixed-origin client refuses redirects and wrong response fence; credential persists privately first", async () => {
  const directory = temporary(), path = join(directory, "credential");
  const credential = executorCredential(path);
  expect(executorCredential(path)).toBe(credential);
  expect(readFileSync(path, "utf8")).toBe(credential);
  chmodSync(path, 0o644); expect(() => executorCredential(path)).toThrow("Unsafe");
  let redirect = true;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = await request.json() as { requestId: string };
    if (redirect) return new Response(null, { status: 302, headers: { location: "/other" } });
    return Response.json({ v: EXECUTOR_PROTOCOL, requestId: input.requestId, ok: true, data: { executorId: "wrong", generation: 1, incarnation: "i", authorizedForMs: 1, launches: [], controls: [], questions: [] } });
  } });
  try {
    const client = createExecutorClient(`http://127.0.0.1:${server.port}`, randomBytes(32).toString("hex"));
    const input = { v: EXECUTOR_PROTOCOL, requestId: "poll", executorId: "device", generation: 1, incarnation: "i", waitMs: 0 };
    await expect(client.request("poll", input)).rejects.toThrow();
    redirect = false; await expect(client.request("poll", input)).rejects.toThrow("fence");
    expect(() => createExecutorClient(`http://127.0.0.1:${server.port}/path`, credential)).toThrow("origin");
  } finally { server.stop(true); }
});
test("real source spool restarts with stable sequence, ACK, gap and corrupted digest rejection", () => {
  const journal = new ExecutorJournal(temporary()), assignment = executorAssignmentSchema.parse(fixture.assignment), unit = assignmentUnit(assignment);
  journal.intent(assignment);
  const spool = new ExecutorSpool(journal);
  spool.append(unit, { kind: "gap", throughSourceSeq: 2, reason: "truncated" });
  expect(new ExecutorSpool(journal).batch(unit)[0]?.sourceSeq).toBe(1);
  expect(() => spool.acknowledge(unit, 1)).toThrow("splits");
  spool.acknowledge(unit, 2);
  spool.append(unit, { kind: "gap", throughSourceSeq: 3, reason: "backpressure" });
  expect(spool.batch(unit)[0]?.sourceSeq).toBe(3);
  const path = join(journal.directory, `${unit}.spool`), value = JSON.parse(readFileSync(path, "utf8"));
  value.records[0].digest = "0".repeat(64); writeFileSync(path, JSON.stringify(value));
  expect(() => spool.read(unit)).toThrow("sequence");
});
test("real separate worktree, manifest disk verification, alias and durable physical lock rejection", async () => {
  const root = temporary(), repository = join(root, "repository");
  const run = (...args: string[]) => {
    const result = spawnSync("git", args, { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim();
  };
  run("init", repository); writeFileSync(join(repository, "a.txt"), "original");
  run("-C", repository, "add", "a.txt"); run("-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "test");
  const baseline = { kind: "commit" as const, digest: run("-C", repository, "rev-parse", "HEAD") }, placement = { executorId: "device", projectRef: "project", mappingRevision: 1 };
  const mapping = { placement, canonicalPath: repository, directoryIdentity: localDirectoryIdentity(repository), baseline };
  const input = { binding: { executorId: "device" }, work: { workId: "work", workspaceRef: "workspace", workspaceMode: "existing" as const, baseline }, mapping, managedRoot: join(root, "managed") };
  const prepared = await prepareLockedLocalWorkspace(input);
  await expect(prepareLockedLocalWorkspace({ ...input, work: { ...input.work, workId: "other", workspaceRef: "other" } })).rejects.toThrow();
  const source = { files: [{ path: "a.txt", sha256: new Bun.CryptoHasher("sha256").update("original").digest("hex") }] };
  expect(await verifyLocalSource({ cwd: prepared.cwd, placement, workspace: prepared.workspace, source, now: new Date() })).toMatchObject({ stage: "claim", fileCount: 1, manifestDigest: localDigest(source) });
  writeFileSync(join(repository, "a.txt"), "changed");
  await expect(verifyLocalSource({ cwd: prepared.cwd, placement, workspace: prepared.workspace, source, now: new Date() })).rejects.toThrow("differs");
  prepared.release();
  const independent = await prepareLockedLocalWorkspace({ ...input, work: { ...input.work, workspaceMode: "independent_worktree" } });
  expect(readFileSync(join(independent.cwd, "a.txt"), "utf8")).toBe("original");
  const alias = join(root, "alias"); symlinkSync(repository, alias);
  await expect(prepareLockedLocalWorkspace({ ...input, mapping: { ...mapping, canonicalPath: alias } })).rejects.toThrow("physical");
  independent.release();
});

test("real allocator rejects third active spool and aggregate metadata; final journal headroom stays usable", () => {
  const store = new ExecutorJournal(temporary()), spool = new ExecutorSpool(store);
  const assignments = [1, 2, 3].map(index => executorAssignmentSchema.parse({ ...fixture.assignment, assignmentId: `allocator-${index}`, attemptId: `allocator-${index}`, workId: `allocator-${index}`, runId: `allocator-${index}` }));
  for (const assignment of assignments) store.intent(assignment);
  const item = { kind: "gap" as const, throughSourceSeq: 1, reason: "truncated" as const };
  spool.append(assignmentUnit(assignments[0]!), item); spool.append(assignmentUnit(assignments[1]!), item);
  expect(() => spool.append(assignmentUnit(assignments[2]!), item)).toThrow("capacity");
  const value = store.read(assignmentUnit(assignments[0]!))!;
  for (let i = 0; i < 7; i++) writeFileSync(join(store.directory, `unknown-${i}.json`), " ".repeat(330000), { mode: 0o600 });
  expect(() => store.write(value)).toThrow("aggregate");
});
