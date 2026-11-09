import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildProcessHelper } from "../scripts/build-helper";
import { processCapability, requireDescendantStop, spawnSupervised } from "./index";

const windows = process.platform === "win32";
const fixture = join(import.meta.dir, "windows.fixture.mjs");
let buildDir: string, helperPath: string, wrapper: string, escapeProbe: string;
beforeAll(async () => {
  if (!windows) return;
  buildDir = mkdtempSync(join(tmpdir(), "chrona Windows build "));
  helperPath = buildProcessHelper(join(buildDir, "guardian.exe"));
  wrapper = join(buildDir, "process.mjs");
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "index.ts")], target: "node", format: "esm" });
  if (!build.success) throw new Error("Could not prepare wrapper");
  await Bun.write(wrapper, build.outputs[0]!);
  escapeProbe = join(buildDir, "escape.exe");
  const compiler = process.env.CC ?? "cl";
  const source = join(import.meta.dir, "windows-escape.fixture.c");
  const flags = /^(cl|clang-cl)(\.exe)?$/i.test(basename(compiler))
    ? ["/nologo", "/std:c11", "/O2", "/W4", "/WX", source, `/Fe:${escapeProbe}`, `/Fo:${escapeProbe}.obj`]
    : ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-municode", source, "-o", escapeProbe];
  const result = spawnSync(compiler, flags, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
});
afterAll(() => { if (buildDir) rmSync(buildDir, { recursive: true, force: true }); });
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(10);
  }
}
function pids(root: string) {
  return ["task", "middle", "leaf"].filter(name => existsSync(join(root, name))).map(name => Number(readFileSync(join(root, name), "utf8")));
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function stopped(root: string, count: number) {
  expect(pids(root)).toHaveLength(count);
  await until(() => pids(root).every(pid => !alive(pid)), "Windows descendant still alive");
  const beat = join(root, "leaf.heartbeat");
  const last = readFileSync(beat, "utf8");
  await Bun.sleep(150);
  expect(readFileSync(beat, "utf8")).toBe(last);
}
function clean(root: string) {
  for (const pid of pids(root)) { try { process.kill(pid, "SIGKILL"); } catch { /* exited */ } }
  rmSync(root, { recursive: true, force: true });
}

describe.skipIf(!windows)("Windows native acceptance (requires Windows, not emulation)", () => {
  test("capability identifies the installed Job backend but keeps native validation pending", () => {
    expect(processCapability({ helperPath })).toMatchObject({ available: true, backend: "windows-job", scope: "descendants", validation: "pending", treeClean: false });
  });
  for (const runtime of ["bun", "node"] as const) {
    for (const action of ["cancel", "timeout", "exit", "owner-death", "owner-exit", "guardian-death", "root-death"] as const) {
      test(`${runtime}: ${action} contains three detached generations`, async () => {
        const executable = runtime === "bun" ? process.execPath : Bun.which("node");
        // Native acceptance must fail if either required runtime is missing.
        if (!executable) throw new Error(`${runtime} required for native acceptance`);
        const root = mkdtempSync(join(tmpdir(), "chrona Windows tree "));
        const owner = spawn(executable, [fixture, "owner", root, helperPath, wrapper, action], { stdio: ["ignore", "ignore", "pipe"] });
        let errors = "";
        owner.stderr!.on("data", chunk => { errors += chunk; });
        const ownerExit = new Promise(resolve => owner.once("exit", resolve));
        try {
          await until(() => existsSync(join(root, "owner.json")), `owner did not start: ${errors}`);
          const info = JSON.parse(readFileSync(join(root, "owner.json"), "utf8"));
          if (action === "owner-death") owner.kill("SIGKILL");
          if (action === "guardian-death") process.kill(info.guardian, "SIGKILL");
          if (action === "root-death") process.kill(info.task, "SIGKILL");
          await ownerExit;
          if (action !== "owner-death" && action !== "owner-exit") {
            const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
            expect(result).toMatchObject({ stop: { state: action === "guardian-death" ? "unknown" : "stopped", scope: "descendants", treeClean: action !== "guardian-death" } });
            if (action === "exit") expect(result.code).toBe(7);
            if (action === "guardian-death") expect(() => requireDescendantStop(result)).toThrow("stop unknown");
          }
          await stopped(root, 3);
        } finally { owner.kill("SIGKILL"); clean(root); }
      }, 15000);
    }
  }
  for (const action of ["cancel", "exit"] as const) test(`explicit breakaway denied; nested Job survives leader until outer cleanup: ${action}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona Windows escape "));
    const task = spawnSupervised(escapeProbe, [action, root], { helperPath });
    task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume();
    try {
      await task.ready;
      await until(() => existsSync(join(root, "leaf.heartbeat")), "nested job child did not start");
      expect(readFileSync(join(root, "breakaway-error"), "utf8")).toBe("5");
      await until(() => existsSync(join(root, "nested-breakaway")), "nested breakaway child did not start");
      if (action === "cancel") task.stop();
      expect(requireDescendantStop(await task.exited)).toMatchObject({ code: action === "exit" ? 7 : null, stop: { treeClean: true } });
      await stopped(root, 3);
    } finally { task.stop(); await task.exited; clean(root); }
  }, 15000);
  test("AbortSignal stops detached descendants", async () => {
    const root = mkdtempSync(join(tmpdir(), "chrona Windows abort "));
    const controller = new AbortController();
    const task = spawnSupervised(process.execPath, [fixture, "task", root], { helperPath, signal: controller.signal });
    task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume();
    try {
      await task.ready;
      await until(() => existsSync(join(root, "leaf")), "leaf did not start");
      controller.abort(); task.stop();
      expect(requireDescendantStop(await task.exited).stop.treeClean).toBe(true);
      await stopped(root, 3);
    } finally { task.stop(); await task.exited; clean(root); }
  }, 15000);
  for (const runtime of ["bun", "node"] as const) test(`${runtime}: argv Unicode/empty/quotes/backslashes and status-like output`, async () => {
    const executable = runtime === "bun" ? process.execPath : Bun.which("node");
    if (!executable) throw new Error("Node required");
    const args = ["", "a b", 'a"b', "C:\\path with space\\", "你好", "\\\\", 'tail\\"'];
    const task = spawnSupervised(executable, [fixture, "argv", ...args], { helperPath });
    let out = "", err = "";
    const input = "stdin roundtrip 中文\n";
    task.process.stdin.end(input);
    task.process.stdout.on("data", chunk => { out += chunk; });
    task.process.stderr.on("data", chunk => { err += chunk; });
    expect(requireDescendantStop(await task.exited).code).toBe(0);
    expect(JSON.parse(out)).toEqual({ args, input });
    expect(err).toContain('"descendantsStopped":true');
  });
  test("missing executable fails before readiness and cannot assert descendant stop", async () => {
    const task = spawnSupervised("Z:\\chrona-does-not-exist\\program.exe", [], { helperPath });
    task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume();
    await expect(task.ready).rejects.toThrow("before readiness");
    expect(await task.exited).toMatchObject({ stop: { state: "unknown", treeClean: false } });
  });
});
