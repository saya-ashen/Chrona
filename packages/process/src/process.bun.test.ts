import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProcessHelper } from "../scripts/build-helper";
import { processCapability, spawnSupervised } from "./index";

const posix = process.platform === "linux" || process.platform === "darwin";
const fixture = join(import.meta.dir, "subprocess.fixture.ts");
const node = Bun.which("node");
let buildDir: string, helperPath: string, nodeWrapper: string;
beforeAll(async () => {
  if (!posix) return;
  buildDir = mkdtempSync(join(tmpdir(), "chrona-guardian-build-"));
  helperPath = buildProcessHelper(join(buildDir, "guardian"));
  if (node) {
    nodeWrapper = join(buildDir, "node-process.mjs");
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, "index.ts")], target: "node", format: "esm" });
    if (!build.success) throw new Error("Could not prepare Node process wrapper");
    await Bun.write(nodeWrapper, build.outputs[0]!);
  }
});
afterAll(() => { if (buildDir) rmSync(buildDir, { recursive: true, force: true }); });

async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(10);
  }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function pids(root: string) {
  return ["task", "middle", "leaf"].filter(name => existsSync(join(root, name))).map(name => Number(readFileSync(join(root, name), "utf8")));
}
function clean(root: string) {
  for (const pid of pids(root)) { try { process.kill(pid, "SIGKILL"); } catch { /* exited */ } }
  rmSync(root, { recursive: true, force: true });
}
const treeClean = process.platform === "linux";
const scope = treeClean ? "descendants" : "process-group";
function start(root: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}, mode = "") {
  const task = spawnSupervised(process.execPath, [fixture, "task", root, mode], { helperPath, ...options });
  task.process.stdout.resume(); task.process.stderr.resume(); task.process.stdin.end();
  return task;
}

for (const platform of ["win32", "freebsd", "unknown"]) test(`${platform} cannot launch when backend or helper is absent`, () => {
  expect(processCapability({ platform, helperPath: "/does/not/matter" })).toMatchObject({ available: false, backend: "unsupported", treeClean: false });
});
test("missing guardian is unavailable and cannot launch a task", () => {
  expect(processCapability({ helperPath: "/not/a/guardian" }).available).toBe(false);
  expect(() => spawnSupervised(process.execPath, ["-e", "process.exit(0)"], { helperPath: "/not/a/guardian" })).toThrow("guardian missing");
});

describe.skipIf(!posix)("native POSIX guardian with real local subprocesses", () => {
  for (const method of ["stop", "abort", "timeout"] as const) test(`${method} kills three generations and reports native stop evidence`, async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-process-tree-"));
    const controller = new AbortController();
    const task = start(root, method === "timeout" ? { timeoutMs: 500 } : { signal: controller.signal });
    try {
      const ready = await task.ready;
      await until(() => existsSync(join(root, "leaf")), "descendants did not start");
      expect(ready.groupId).toBe(ready.pid);
      const descendants = pids(root);
      expect(descendants).toHaveLength(3);
      if (method === "stop") { task.stop(); task.stop(); }
      if (method === "abort") controller.abort();
      expect(await task.exited).toMatchObject({ code: null, signal: "SIGKILL", stop: { state: "stopped", scope, treeClean } });
      await until(() => descendants.every(pid => !alive(pid)), "descendants remain after stop");
    } finally { task.stop(); await task.exited; clean(root); }
  });

  test("task leader exit retains its group and kills inherited grandchildren before exit resolves", async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-process-leader-exit-"));
    const task = start(root, {}, "exit");
    try {
      expect(await task.exited).toMatchObject({ code: 7, signal: null, stop: { state: "stopped", treeClean, reason: "exit" } });
      expect(pids(root)).toHaveLength(3);
      expect(pids(root).every(pid => !alive(pid))).toBe(true);
    } finally { task.stop(); await task.exited; clean(root); }
  });

  for (const mode of ["SIGKILL", "exit"] as const) test(`owner ${mode} closes the native lifetime pipe and kills the task group`, async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-process-owner-death-"));
    const owner = spawn(process.execPath, [fixture, "owner", root, helperPath], {
      env: { ...process.env, FIXTURE_OWNER_EXIT: mode === "exit" ? "yes" : "no" }, stdio: "ignore",
    });
    const exited = new Promise(resolve => owner.once("exit", resolve));
    try {
      await until(() => existsSync(join(root, "leaf")) && existsSync(join(root, "owner.json")), "owner did not start descendants");
      const descendants = pids(root);
      if (mode === "SIGKILL") owner.kill("SIGKILL");
      await exited;
      await until(() => descendants.every(pid => !alive(pid)), "owner death left descendants running");
    } finally { owner.kill("SIGKILL"); clean(root); }
  });

  test("guardian SIGKILL is unknown, never successful tree cleanup, and does not hang on inherited pipes", async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-process-guardian-death-"));
    const task = start(root);
    try {
      await task.ready;
      await until(() => existsSync(join(root, "leaf")), "descendants did not start");
      process.kill(task.pid!, "SIGKILL");
      expect(await task.exited).toMatchObject({ stop: { state: "unknown", treeClean: false } });
      expect(pids(root).some(alive)).toBe(true);
    } finally { clean(root); }
  });

  for (const mode of ["escape", "exit-escape", "root-SIGKILL", "owner-escape"] as const) test.skipIf(!treeClean)(`Linux subreaper stops setsid descendants: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-process-escape-"));
    const owner = mode === "owner-escape" ? spawn(process.execPath, [fixture, "owner", root, helperPath, "escape"], { stdio: "ignore" }) : undefined;
    const ownerExit = owner && new Promise(resolve => owner.once("exit", resolve));
    const task = owner ? undefined : start(root, {}, mode === "root-SIGKILL" ? "escape" : mode);
    try {
      await until(() => existsSync(join(root, "leaf")), "escaped descendants did not start");
      const descendants = pids(root);
      if (owner) { owner.kill("SIGKILL"); await ownerExit; }
      else {
        if (mode === "escape") task!.stop();
        if (mode === "root-SIGKILL") process.kill((await task!.ready).pid, "SIGKILL");
        expect(await task!.exited).toMatchObject({ stop: { state: "stopped", scope: "descendants", treeClean: true } });
      }
      await until(() => descendants.every(pid => !alive(pid)), "escaped descendants remain after cleanup");
    } finally { owner?.kill("SIGKILL"); task?.stop(); if (task) await task.exited; clean(root); }
  });

  for (const action of ["cancel", "exit", "owner-death"] as const) test.skipIf(!treeClean || !node)(`Node native pipes and escaped descendant cleanup: ${action}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-process-node-"));
    const owner = spawn(node!, [join(import.meta.dir, "node.fixture.mjs"), "owner", root, helperPath, nodeWrapper, action], { stdio: "ignore" });
    const ownerExit = new Promise(resolve => owner.once("exit", resolve));
    try {
      await until(() => existsSync(join(root, "owner.json")), "Node owner did not start");
      if (action === "owner-death") owner.kill("SIGKILL");
      await ownerExit;
      if (action !== "owner-death") expect(JSON.parse(readFileSync(join(root, "result.json"), "utf8"))).toMatchObject({ code: action === "exit" ? 7 : null, stop: { state: "stopped", scope: "descendants", treeClean: true } });
      expect(pids(root)).toHaveLength(2);
      await until(() => pids(root).every(pid => !alive(pid)), "Node owner left descendants alive");
    } finally { owner.kill("SIGKILL"); clean(root); }
  });

  test("exec failure and pre-aborted launches are explicit", async () => {
    const task = spawnSupervised("/no/such/executable", [], { helperPath });
    task.process.stdout.resume(); task.process.stderr.resume(); task.process.stdin.end();
    expect(await task.exited).toMatchObject({ code: 127, stop: { state: "stopped", treeClean } });
    expect(() => spawnSupervised(process.execPath, [], { helperPath, signal: AbortSignal.abort(new Error("already cancelled")) })).toThrow("already cancelled");
  });
});
