import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildArtifacts } from "../../../build/manifest";
import { configureExecutor, privateRead, readExecutorConfig } from "./executor-config";
import { drainExecutor, pairExecutor, runExecutor } from "./executor-runtime";
import { createProgram } from "./program";
import { EXECUTOR_PROTOCOL, executorAssignmentSchema, executorFinalSchema, executorDigest } from "@chrona/contracts/steward";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
function fixture(origin = "http://127.0.0.1:1") {
  const base = mkdtempSync(join(tmpdir(), "chrona-executor-cli-test-")), dataDir = join(base, "data"), profile = join(base, "profile"), project = join(base, "project"), request = join(base, "request.json");
  mkdirSync(profile, { mode: 0o700 }); mkdirSync(project);
  const input = { origin, label: "Fixture device", pi: { command: realpathSync(process.execPath), agentDir: profile, model: "fixture-model" }, mappings: [{ projectRef: "repo", mappingRevision: 1, canonicalPath: project, baseline: { kind: "commit", digest: "a".repeat(40) } }] };
  writeFileSync(request, JSON.stringify(input), { mode: 0o600 });
  return { base, dataDir, profile, project, request, input };
}
function server(handler: (request: Request, body: Record<string, unknown>) => unknown | Promise<unknown>) {
  const instance = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) { return Response.json(await handler(request, await request.json() as Record<string, unknown>)); } });
  servers.push(instance); return instance;
}
const ok = (requestId: unknown, data: unknown) => ({ v: EXECUTOR_PROTOCOL, requestId, ok: true, data });
const receipt = { executorId: "fixture-device", generation: 1, heartbeatMs: 10_000, graceMs: 60_000 };
test("CLI advertises explicit native foreground handoff and existing start/admin commands", () => {
  const program = createProgram(), command = program.commands.find(command => command.name() === "executor")!;
  expect(command.description()).toContain("foreground owner handoff"); expect(command.description()).toContain("no unattended restart");
  expect(command.commands.map(command => command.name())).toEqual(["configure", "pair", "drain", "run"]);
  expect(program.commands.map(command => command.name())).toContain("start"); expect(program.commands.map(command => command.name())).toContain("admin");
  expect(buildArtifacts.executor).toMatchObject({ platform: "linux", manager: "systemd 262", processEntry: "__executor-process", foregroundOnly: true });
});
test("configuration uses only explicit private profile and fixed commit mappings, no owner credentials", () => {
  const f = fixture(); configureExecutor(f.dataDir, f.request);
  const config = readExecutorConfig(f.dataDir);
  expect(config.pi.agentDir).toBe(f.profile); expect(config.mappings[0]!.directoryIdentity).toHaveLength(64);
  expect(statSync(f.dataDir).mode & 0o777).toBe(0o700); expect(statSync(join(f.dataDir, "config.json")).mode & 0o777).toBe(0o600);
  expect(config).not.toHaveProperty("API_KEY");
  for (const extra of [{ API_KEY: "test-owner-sentinel" }, { pi: { ...f.input.pi, agentDir: "relative" } }, { mappings: [{ ...f.input.mappings[0], baseline: { kind: "snapshot", digest: "snapshot" } }] }]) {
    writeFileSync(f.request, JSON.stringify({ ...f.input, ...extra })); expect(() => configureExecutor(f.dataDir, f.request)).toThrow();
  }
});
test("unsafe config/profile and linked request are refused without chmod of selected directories", () => {
  const f = fixture(); chmodSync(f.profile, 0o755); expect(() => configureExecutor(f.dataDir, f.request)).toThrow("private"); expect(statSync(f.profile).mode & 0o777).toBe(0o755);
  chmodSync(f.profile, 0o700); configureExecutor(f.dataDir, f.request);
  chmodSync(join(f.dataDir, "config.json"), 0o644); expect(() => readExecutorConfig(f.dataDir)).toThrow();
  const linked = join(f.base, "linked.json"); symlinkSync(f.request, linked); expect(() => privateRead(linked)).toThrow();
});
test("pair uses durable device credential, fixed endpoint and original receipt on retry; code is not persisted", async () => {
  const calls: { path: string; header: string | null; code: unknown }[] = [];
  const instance = server((request, body) => { calls.push({ path: new URL(request.url).pathname, header: request.headers.get("authorization"), code: body.code }); return ok(body.requestId, receipt); });
  const f = fixture(instance.url.origin); configureExecutor(f.dataDir, f.request);
  expect(await pairExecutor(f.dataDir, "b".repeat(64))).toEqual({ executorId: receipt.executorId, generation: 1 });
  const credential = readFileSync(join(f.dataDir, "credential"), "utf8");
  expect(await pairExecutor(f.dataDir, "b".repeat(64))).toEqual({ executorId: receipt.executorId, generation: 1 });
  expect(calls).toHaveLength(2); expect(calls.every(call => call.path === "/api/executor/v1/pair" && call.header === `Bearer ${credential}`)).toBe(true);
  const saved = readFileSync(join(f.dataDir, "identity.json"), "utf8") + readFileSync(join(f.dataDir, "config.json"), "utf8");
  expect(saved).not.toContain("b".repeat(64)); expect(saved).not.toContain(credential); expect(saved).not.toContain("API_KEY");
  expect(() => configureExecutor(f.dataDir, f.request)).toThrow("immutable");
});
test("lost pair response keeps same credential and recoverable identity on explicit retry", async () => {
  let first = true; const headers: string[] = [];
  const instance = server((request, body) => { headers.push(request.headers.get("authorization")!); if (first) { first = false; return { invalid: true }; } return ok(body.requestId, receipt); });
  const f = fixture(instance.url.origin); configureExecutor(f.dataDir, f.request);
  await expect(pairExecutor(f.dataDir, "c".repeat(64))).rejects.toThrow();
  expect(existsSync(join(f.dataDir, "credential"))).toBe(true); expect(existsSync(join(f.dataDir, "identity.json"))).toBe(false);
  await pairExecutor(f.dataDir, "c".repeat(64)); expect(headers[0]).toBe(headers[1]);
});
test("EOF produces durable fresh proposal but never makes a request or launches; Enter cannot bypass owner binding", async () => {
  const paths: string[] = [];
  const instance = server((request, body) => { paths.push(new URL(request.url).pathname); return paths.at(-1)!.endsWith("/pair") ? ok(body.requestId, receipt) : { v: EXECUTOR_PROTOCOL, requestId: body.requestId, ok: false, error: { code: "forbidden", message: "Owner has not authorized incarnation", retryable: false } }; });
  const f = fixture(instance.url.origin); configureExecutor(f.dataDir, f.request); await pairExecutor(f.dataDir, "d".repeat(64));
  let initial: string | undefined;
  await runExecutor(f.dataDir, async proposal => { expect(proposal.expectedIncarnation).toBeNull(); initial = proposal.nextIncarnation; return false; }, new AbortController().signal);
  expect(paths).toEqual(["/api/executor/v1/pair"]); expect(readFileSync(join(f.dataDir, "incarnation"), "utf8")).toBe(initial!);
  await expect(runExecutor(f.dataDir, async proposal => { expect(proposal.expectedIncarnation).toBe(initial!); expect(proposal.nextIncarnation).not.toBe(initial!); return true; }, new AbortController().signal)).rejects.toThrow("forbidden");
  expect(paths).toEqual(["/api/executor/v1/pair", "/api/executor/v1/reconcile"]);
});
test("internal same-entry source dispatch runs before server config and strips unapproved environment", () => {
  const f = fixture(), ready = join(f.base, "ready"); writeFileSync(ready, "ready");
  const command = [process.execPath, resolve(import.meta.dir, "index.ts"), "__executor-process", JSON.stringify(["TEST_APPROVED"]), ready, process.execPath, "-e", 'console.log(JSON.stringify({approved:process.env.TEST_APPROVED,owner:process.env.API_KEY,db:process.env.DATABASE_URL}));process.exit(37)'];
  const result = spawnSync(command[0]!, command.slice(1), { encoding: "utf8", timeout: 10_000, cwd: f.base, env: { ...process.env, TEST_APPROVED: "fixture", API_KEY: "test-owner-sentinel", DATABASE_URL: "invalid:test-do-not-load", CHRONA_CONFIG_DIR: join(f.base, "must-not-create-config"), CHRONA_DATA_DIR: join(f.base, "must-not-create-db") } });
  expect(result.status).toBe(37); expect(JSON.parse(result.stdout)).toEqual({ approved: "fixture" }); expect(result.stderr).toBe("");
  expect(existsSync(join(f.base, "must-not-create-config"))).toBe(false); expect(existsSync(join(f.base, "must-not-create-db"))).toBe(false); expect(existsSync(ready)).toBe(false);
});

test("source executor help loads no database or personal configuration", () => {
  const f = fixture();
  const result = spawnSync(process.execPath, [resolve(import.meta.dir, "index.ts"), "executor", "--help"], { cwd: f.base, encoding: "utf8", timeout: 10_000, env: { ...process.env, DATABASE_URL: "invalid:test-do-not-load", CHRONA_CONFIG_DIR: join(f.base, "absent-config"), CHRONA_DATA_DIR: join(f.base, "absent-data") } });
  expect(result.status).toBe(0); expect(result.stdout).toContain("foreground owner handoff"); expect(result.stderr).toBe("");
  expect(existsSync(join(f.base, "absent-config"))).toBe(false); expect(existsSync(join(f.base, "absent-data"))).toBe(false);
});

test("foreground enters original daemon only after matching device reconcile and closes cleanly", async () => {
  const abort = new AbortController(), paths: string[] = []; let proposed = "";
  const instance = server((request, body) => {
    const path = new URL(request.url).pathname; paths.push(path);
    if (path.endsWith("/pair")) return ok(body.requestId, receipt);
    expect(body.incarnation).toBe(proposed);
    const fence = { executorId: receipt.executorId, generation: 1, incarnation: proposed };
    if (path.endsWith("/reconcile")) return ok(body.requestId, { ...fence, decisions: [], after: null, reconciled: true });
    if (path.endsWith("/poll")) { abort.abort(); return ok(body.requestId, { ...fence, authorizedForMs: 60_000, launches: [], controls: [], questions: [] }); }
    throw new Error("Unexpected route");
  });
  const f = fixture(instance.url.origin); configureExecutor(f.dataDir, f.request); await pairExecutor(f.dataDir, "e".repeat(64));
  const timer = setTimeout(() => abort.abort(), 3000);
  try { await runExecutor(f.dataDir, async proposal => { proposed = proposal.nextIncarnation; return true; }, abort.signal); } finally { clearTimeout(timer); }
  expect(paths).toEqual(["/api/executor/v1/pair", "/api/executor/v1/reconcile", "/api/executor/v1/poll"]);
});

test("executor runtime pure imports cannot initialize a database even with invalid DB configuration", () => {
  const f = fixture();
  const code = `await import(${JSON.stringify(resolve(import.meta.dir, "executor-runtime.ts"))});console.log("pure executor runtime");`;
  const result = spawnSync(process.execPath, ["-e", code], { cwd: f.base, encoding: "utf8", timeout: 10_000, env: { ...process.env, DATABASE_URL: "invalid:test-no-database", CHRONA_DATA_DIR: join(f.base, "must-not-create-db") } });
  expect(result.status).toBe(0); expect(result.stdout.trim()).toBe("pure executor runtime"); expect(result.stderr).toBe(""); expect(existsSync(join(f.base, "must-not-create-db"))).toBe(false);
});

test("OS lock survives flock helper exit, blocks another CLI before proposal writes, releases on EOF, and has no internal bypass", async () => {
  let pairRequests = 0;
  const instance = server((_, body) => { pairRequests++; return ok(body.requestId, receipt); });
  const f = fixture(instance.url.origin); configureExecutor(f.dataDir, f.request); await pairExecutor(f.dataDir, "f".repeat(64));
  const args = [process.execPath, resolve(import.meta.dir, "index.ts")], env = { ...process.env, API_KEY: "test-owner-sentinel", DATABASE_URL: "invalid:test-no-db" };
  const first = Bun.spawn([...args, "executor", "run", "--data-dir", f.dataDir], { cwd: f.base, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => first.kill("SIGKILL"), 5000);
  try {
    const reader = first.stdout.getReader(), ready = await reader.read(); reader.releaseLock();
    const proposal = JSON.parse(new TextDecoder().decode(ready.value));
    expect(proposal.nextIncarnation).toHaveLength(64); expect(first.exitCode).toBeNull();
    const saved = readFileSync(join(f.dataDir, "incarnation"), "utf8");
    const second = Bun.spawn([...args, "executor", "pair", "--data-dir", f.dataDir], { cwd: f.base, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    second.stdin.write("f".repeat(64) + "\n"); second.stdin.end();
    expect(await second.exited).toBe(75); expect(await new Response(second.stderr).text()).toContain("busy");
    const drain = Bun.spawn([...args, "executor", "drain", "--data-dir", f.dataDir], { cwd: f.base, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(await drain.exited).toBe(75); expect(await new Response(drain.stderr).text()).toContain("busy");
    expect(existsSync(join(f.dataDir, "journal"))).toBe(false);
    expect(readFileSync(join(f.dataDir, "incarnation"), "utf8")).toBe(saved); expect(pairRequests).toBe(1);
    const bypass = spawnSync(args[0]!, [...args.slice(1), "__executor-locked", "run", f.dataDir], { cwd: f.base, env, encoding: "utf8", timeout: 5000 });
    expect(bypass.status).not.toBe(0); expect(readFileSync(join(f.dataDir, "incarnation"), "utf8")).toBe(saved);
    first.stdin.end(); expect(await first.exited).toBe(0);
    const invalid = Bun.spawn([...args, "executor", "pair", "--data-dir", f.dataDir], { cwd: f.base, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    invalid.stdin.write("invalid\n"); invalid.stdin.end(); expect(await invalid.exited).not.toBe(0); expect(pairRequests).toBe(1);
    const retry = Bun.spawn([...args, "executor", "pair", "--data-dir", f.dataDir], { cwd: f.base, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    retry.stdin.write("f".repeat(64) + "\n"); retry.stdin.end(); expect(await retry.exited).toBe(0); expect(pairRequests).toBe(2);
    expect(statSync(join(f.dataDir, "foreground.lock")).mode & 0o777).toBe(0o600);
  } finally { clearTimeout(timer); if (first.exitCode === null) first.kill("SIGKILL"); await first.exited; }
}, 15_000);


test("drain uses original final/fence only; missing Pi profile is irrelevant and unconfirmed ACK fails", async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = []; let confirmed = false;
  const instance = server((request, body) => {
    calls.push({ path: new URL(request.url).pathname, body });
    return ok(body.requestId, { digest: body.digest, accepted: true, stopConfirmed: confirmed });
  });
  const f = fixture(instance.url.origin); configureExecutor(f.dataDir, f.request);
  const incarnation = "c".repeat(64);
  writeFileSync(join(f.dataDir, "identity.json"), JSON.stringify({ executorId: receipt.executorId, generation: 1, origin: instance.url.origin, label: f.input.label }), { mode: 0o600 });
  writeFileSync(join(f.dataDir, "credential"), "e".repeat(64), { mode: 0o600 });
  writeFileSync(join(f.dataDir, "incarnation"), incarnation, { mode: 0o600 });
  const { ExecutorJournal } = await import("@chrona/integrations/executor");
  const protocolFixture = (await import("../../contracts/fixtures/executor-v1/cases.json")).default;
  const assignment = executorAssignmentSchema.parse({ ...protocolFixture.assignment, executorId: receipt.executorId, incarnation, mapping: { ...protocolFixture.assignment.mapping, executorId: receipt.executorId } });
  const journal = new ExecutorJournal(join(f.dataDir, "journal")), intent = journal.intent(assignment);
  journal.final(intent.unit, executorFinalSchema.parse({ ...protocolFixture.final, launchDigest: await executorDigest(assignment), stop: { kind: "unknown", reason: "Lost observation" } }));
  const refusedRun = Bun.spawn([process.execPath, resolve(import.meta.dir, "index.ts"), "executor", "run", "--data-dir", f.dataDir], { cwd: f.base, env: { ...process.env, DATABASE_URL: "invalid:test-no-db" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  expect(await refusedRun.exited, await new Response(refusedRun.stderr).text()).toBe(0);
  const refusedProposal = privateRead(join(f.dataDir, "incarnation"));
  expect(refusedProposal).not.toBe(incarnation); expect(calls).toHaveLength(0);
  rmSync(f.profile, { recursive: true }); rmSync(f.project, { recursive: true });
  await expect(drainExecutor(f.dataDir)).rejects.toThrow();
  expect(journal.read(intent.unit)?.ack?.stopConfirmed).toBe(false);
  confirmed = true; await drainExecutor(f.dataDir);
  expect(calls).toHaveLength(2); expect(calls.every(call => call.path === "/api/executor/v1/final")).toBe(true);
  expect(calls[0]!.body.final).toEqual(calls[1]!.body.final); expect(calls[0]!.body.digest).toBe(calls[1]!.body.digest);
  expect(calls[0]!.body.incarnation).toBe(incarnation); expect(privateRead(join(f.dataDir, "incarnation"))).toBe(refusedProposal);
  await drainExecutor(f.dataDir); expect(calls).toHaveLength(2);
  const cli = Bun.spawn([process.execPath, resolve(import.meta.dir, "index.ts"), "executor", "drain", "--data-dir", f.dataDir], { cwd: f.base, env: { ...process.env, DATABASE_URL: "invalid:test-no-db", API_KEY: "test-owner-sentinel", CHRONA_CONFIG_DIR: join(f.base, "no-server-config"), CHRONA_DATA_DIR: join(f.base, "no-server-data") }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  expect(await cli.exited, await new Response(cli.stderr).text()).toBe(0);
  expect(existsSync(join(f.base, "no-server-config"))).toBe(false); expect(existsSync(join(f.base, "no-server-data"))).toBe(false);
  expect(calls).toHaveLength(2);
  rmSync(join(f.dataDir, "journal"), { recursive: true });
  await drainExecutor(f.dataDir); expect(existsSync(join(f.dataDir, "journal"))).toBe(false);
  symlinkSync(f.profile, join(f.dataDir, "journal"));
  await expect(drainExecutor(f.dataDir)).rejects.toThrow();
});

test.each(["multiple-incarnations", "other-device", "other-generation", "no-final"])("drain fails closed for %s without requests or proposal writes", async condition => {
  let requests = 0;
  const instance = server(() => { requests++; throw new Error("No request authorized"); });
  const f = fixture(instance.url.origin); configureExecutor(f.dataDir, f.request);
  writeFileSync(join(f.dataDir, "identity.json"), JSON.stringify({ executorId: receipt.executorId, generation: 1, origin: instance.url.origin, label: f.input.label }), { mode: 0o600 });
  writeFileSync(join(f.dataDir, "credential"), "e".repeat(64), { mode: 0o600 });
  const { ExecutorJournal } = await import("@chrona/integrations/executor");
  const protocolFixture = (await import("../../contracts/fixtures/executor-v1/cases.json")).default;
  const journal = new ExecutorJournal(join(f.dataDir, "journal"));
  const original = { ...protocolFixture.assignment, executorId: receipt.executorId, incarnation: "c".repeat(64), mapping: { ...protocolFixture.assignment.mapping, executorId: receipt.executorId } };
  const saved = journal.intent(executorAssignmentSchema.parse(original));
  if (condition !== "no-final") {
    const executorId = condition === "other-device" ? "unrelated-device" : receipt.executorId;
    journal.intent(executorAssignmentSchema.parse({ ...original, assignmentId: "unrelated-assignment", executorId, mapping: { ...original.mapping, executorId }, generation: condition === "other-generation" ? 2 : 1, incarnation: "d".repeat(64) }));
  }
  rmSync(f.profile, { recursive: true });
  await expect(drainExecutor(f.dataDir)).rejects.toThrow();
  expect(requests).toBe(0); expect(existsSync(join(f.dataDir, "incarnation"))).toBe(false);
  expect(journal.read(saved.unit)?.journal.final).toBeNull();
});
