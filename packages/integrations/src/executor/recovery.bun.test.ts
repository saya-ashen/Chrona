import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixture from "../../../contracts/fixtures/executor-v1/cases.json";
import { executorAssignmentSchema } from "@chrona/contracts/steward";
import { assignmentUnit, ExecutorJournal, localDigest, prelaunchTombstone } from "./journal";
import { createDeviceWorkspacePreparer, localDirectoryIdentity } from "./workspaces";
import { createExecutorDaemon } from "./daemon";
import { createExecutorClient } from "./client";
import { observeExecutorStop, recoverExecutorProcess } from "./process";

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), "chrona-recovery-test-")));
const assignment = () => executorAssignmentSchema.parse({ ...fixture.assignment, deadlineAt: new Date(Date.now() + 60_000).toISOString() });

test("prelaunch proof survives crash; spawn fence, legacy state and retire digest cannot become never_started", () => {
  for (const phase of ["prelaunch", "spawn_possible", "legacy"] as const) {
    const store = new ExecutorJournal(temporary()), a = assignment(), unit = assignmentUnit(a);
    const permit = phase === "legacy" ? null : store.prepareLaunch(a);
    if (phase === "legacy") {
      store.intent(a);
      const path = join(store.directory, `${unit}.json`), old = JSON.parse(readFileSync(path, "utf8"));
      delete old.launchState; delete old.workspaceLocks;
      writeFileSync(path, JSON.stringify(old));
    }
    if (phase === "spawn_possible") permit!();
    const restarted = new ExecutorJournal(store.directory), value = restarted.read(unit)!;
    expect(() => restarted.prepareLaunch(a)).toThrow("reconcile without relaunch");
    if (phase === "prelaunch") {
      const proof = restarted.neverStarted(unit);
      expect(proof.journal.tombstoneDigest).toBe(prelaunchTombstone(a));
      expect(restarted.neverStarted(unit)).toEqual(proof);
      expect(() => permit!()).toThrow("permit unavailable");
      expect(recoverExecutorProcess(restarted, unit).state).toBe("stopped");
      expect(() => restarted.write({ ...proof, journal: { ...proof.journal, tombstoneDigest: localDigest({ kind: "retire" }) } })).toThrow("tombstone");
    } else {
      expect(() => restarted.neverStarted(unit)).toThrow("unknown");
      expect(() => restarted.write({ ...value, launchState: "prelaunch" })).toThrow("cannot be reversed");
      expect(recoverExecutorProcess(restarted, unit).state).toBe("unknown");
    }
  }
});

async function workspace(mode: "existing" | "independent_worktree") {
  const root = temporary(), repository = join(root, "repository");
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", repository); writeFileSync(join(repository, "a.txt"), "original");
  git("-C", repository, "add", "a.txt");
  git("-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "test");
  const a = assignment(), baseline = { kind: "commit" as const, digest: git("-C", repository, "rev-parse", "HEAD") };
  a.workspaceMode = mode;
  delete a.source;
  a.mapping.baseline = baseline; a.mapping.directoryIdentity = localDirectoryIdentity(repository);
  const mapping = { placement: { executorId: a.executorId, projectRef: a.mapping.projectRef, mappingRevision: a.mapping.mappingRevision }, canonicalPath: repository, directoryIdentity: a.mapping.directoryIdentity, baseline };
  const managed = join(root, "managed");
  return { root, managed, a, prepare: createDeviceWorkspacePreparer([mapping], managed) };
}

test("crashed assignment lock releases only original persisted prelaunch or manager stop; other assignment and unknown stay held", async () => {
  for (const mode of ["existing", "independent_worktree"] as const) for (const evidence of ["prelaunch", "manager", "unknown", "other", "replaced"] as const) {
    const { root, managed, a, prepare } = await workspace(mode), store = new ExecutorJournal(join(root, "journal")), unit = assignmentUnit(a);
    const permit = store.prepareLaunch(a);
    await prepare(a, lock => { store.recordWorkspaceLock(unit, lock); }); // Discard handle: simulate daemon crash while retaining the filesystem lock.
    const locks = join(managed, "locks"), original = readdirSync(locks);
    expect(original.length).toBeGreaterThan(0);
    if (evidence === "prelaunch" || evidence === "other" || evidence === "replaced") store.neverStarted(unit);
    if (evidence === "manager" || evidence === "unknown") permit();
    if (evidence === "manager") {
      let value = store.read(unit)!;
      value = store.write({ ...value, journal: { ...value.journal, phase: "owned", identity: { bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), unit, invocationId: "a".repeat(32), controlGroup: "/user.slice/test" } } });
      const observation = observeExecutorStop(value, { Id: unit, InvocationID: "a".repeat(32), ExitType: "cgroup", RemainAfterExit: "yes", KillMode: "control-group", MainPID: "0", ActiveState: "active", SubState: "exited", ControlGroup: "" })!;
      store.write({ ...value, observation });
    }
    let saved = new ExecutorJournal(store.directory).read(unit)!;
    if (evidence === "other") {
      const other = executorAssignmentSchema.parse({ ...a, assignmentId: "other-assignment" });
      const otherStore = new ExecutorJournal(join(root, "other")); otherStore.prepareLaunch(other);
      saved = otherStore.neverStarted(assignmentUnit(other));
    }
    if (evidence === "replaced") {
      for (const name of original) {
        const path = join(locks, name), lock = JSON.parse(readFileSync(path, "utf8"));
        lock.token = "f".repeat(64); writeFileSync(path, JSON.stringify(lock));
      }
    }
    prepare.recover(saved);
    if (evidence === "unknown" || evidence === "other" || evidence === "replaced") {
      expect(readdirSync(locks)).toEqual(original);
      await expect(prepare(a)).rejects.toThrow();
    } else {
      expect(readdirSync(locks)).toEqual([]);
      prepare.recover(saved); // Idempotent after crash recovery.
      const retry = await prepare(a); retry.release();
    }
  }
});

test("workspace rejection creates immutable original never_started final and restart never prepares again", async () => {
  const store = new ExecutorJournal(temporary()), a = assignment(), unit = assignmentUnit(a);
  let prepares = 0;
  const options = {
    client: createExecutorClient("http://127.0.0.1:1", "a".repeat(64)), fence: { executorId: a.executorId, generation: a.generation, incarnation: a.incarnation }, journal: store,
    provider: { agentDir: temporary(), model: "fixture", chronaExtension: join(import.meta.dir, "../../../../external-plugins/pi-steward-agent/chrona-tools.ts") },
    prepareWorkspace: async () => { prepares++; throw new Error("Disk/source verification rejected"); },
    canonicalFinal: (final: Parameters<Parameters<typeof createExecutorDaemon>[0]["canonicalFinal"]>[0]) => final,
    captureWorkspaceChanges: async () => { throw new Error("Never capture before process launch"); },
  };
  const daemon = createExecutorDaemon(options);
  await expect(daemon.launch(a, 30_000, Date.now())).rejects.toThrow("verification rejected");
  const saved = store.read(unit)!;
  expect(saved.journal.final?.stop).toEqual({ kind: "never_started", tombstoneDigest: prelaunchTombstone(a) });
  expect(saved.journal.final?.outcome.outcome).toBe("unavailable");
  expect(saved.journal.finalDigest).toBe(localDigest(saved.journal.final));
  await createExecutorDaemon({ ...options, journal: new ExecutorJournal(store.directory) }).launch(a, 30_000, Date.now());
  expect(prepares).toBe(1);
  expect(store.read(unit)).toEqual(saved);
});

test("prelaunch final retries the original digest after lost HTTP ACK and restart; ambiguous source stays held", async () => {
  let dropAck = true;
  const digests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = await request.json() as { v: string; requestId: string; digest: string };
    digests.push(input.digest);
    if (dropAck) { dropAck = false; return Response.json({ lost: true }, { status: 503 }); }
    return Response.json({ v: input.v, requestId: input.requestId, ok: true, data: { digest: input.digest, accepted: true, stopConfirmed: true } });
  } });
  try {
    const store = new ExecutorJournal(temporary()), a = assignment(), unit = assignmentUnit(a);
    const options = {
      client: createExecutorClient(`http://127.0.0.1:${server.port}`, "a".repeat(64)), fence: { executorId: a.executorId, generation: a.generation, incarnation: a.incarnation }, journal: store,
      provider: { agentDir: temporary(), model: "fixture", chronaExtension: join(import.meta.dir, "../../../../external-plugins/pi-steward-agent/chrona-tools.ts") },
      prepareWorkspace: async () => { throw new Error("Prelaunch rejection"); },
      canonicalFinal: (final: Parameters<Parameters<typeof createExecutorDaemon>[0]["canonicalFinal"]>[0]) => final,
      captureWorkspaceChanges: async () => { throw new Error("Never capture before launch"); },
    };
    const daemon = createExecutorDaemon(options);
    await expect(daemon.launch(a, 30_000, Date.now())).rejects.toThrow("rejection");
    await expect(daemon.report()).rejects.toThrow();
    expect(store.read(unit)?.ack).toBeNull();
    const restarted = createExecutorDaemon({ ...options, journal: new ExecutorJournal(store.directory) });
    await restarted.report(); await restarted.report();
    expect(digests).toEqual([store.read(unit)!.journal.finalDigest!, store.read(unit)!.journal.finalDigest!]);
    expect(store.read(unit)?.ack?.stopConfirmed).toBe(true);
    const other = executorAssignmentSchema.parse({ ...a, assignmentId: "ambiguous-source" }), otherUnit = assignmentUnit(other);
    store.prepareLaunch(other);
    restarted.spool.append(otherUnit, { kind: "gap", throughSourceSeq: 1, reason: "truncated" });
    const unknown = restarted.finishPrelaunch(otherUnit);
    expect(unknown.launchState).toBe("unknown");
    expect(unknown.journal.tombstoneDigest).toBeNull();
    expect(unknown.journal.final).toBeNull();
  } finally { server.stop(true); }
});

test("recovered unavailable final needs original source preparation and a persisted stop observation", () => {
  for (const missing of ["prepared", "proof", "neither"] as const) {
    const store = new ExecutorJournal(temporary()), a = executorAssignmentSchema.parse({ ...assignment(), source: { files: [{ path: "source.txt", sha256: "a".repeat(64) }] } }), unit = assignmentUnit(a), permit = store.prepareLaunch(a);
    const sourceReceipt = { placement: { executorId: a.executorId, projectRef: a.mapping.projectRef, mappingRevision: a.mapping.mappingRevision }, baseline: a.mapping.baseline, manifestDigest: localDigest(a.source), fileCount: 1, verifiedAt: new Date().toISOString(), stage: "claim" as const };
    if (missing !== "prepared") store.prepared(unit, sourceReceipt);
    permit(); let value = store.read(unit)!;
    value = store.write({ ...value, journal: { ...value.journal, identity: { bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), unit, invocationId: "a".repeat(32), controlGroup: "/fixture-original" }, phase: "owned" } });
    if (missing !== "proof") {
      const properties = { Id: unit, InvocationID: value.journal.identity!.invocationId, ExitType: "cgroup", RemainAfterExit: "yes", KillMode: "control-group", MainPID: "0", ActiveState: "active", SubState: "exited" };
      store.write({ ...value, observation: observeExecutorStop(value, properties) });
    }
    const daemon = createExecutorDaemon({ client: createExecutorClient("http://127.0.0.1:1", "a".repeat(64)), fence: { executorId: a.executorId, generation: a.generation, incarnation: a.incarnation }, journal: store, provider: { agentDir: temporary(), model: "unused", chronaExtension: "unused" }, prepareWorkspace: async () => { throw new Error("Recovery must not prepare"); }, canonicalFinal: final => final, captureWorkspaceChanges: async () => { throw new Error("Recovery must not capture"); } });
    daemon.finishRecovered(unit);
    if (missing === "neither") {
      expect(store.read(unit)?.journal.final).toMatchObject({ sourceReceipt, missing: true, outcome: { outcome: "unavailable" } });
      expect(store.read(unit)?.journal.final?.changes).toBeUndefined();
      expect(() => store.prepared(unit, null)).toThrow();
    } else expect(store.read(unit)?.journal.final).toBeNull();
  }
});
