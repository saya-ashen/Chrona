import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessStopUnknownError } from "@chrona/process";
import { launchPiProcess } from "./pi-process";

const fixture = join(import.meta.dir, "pi-process.fixture.ts");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pid = (root: string, name: string) => Number(readFileSync(join(root, name), "utf8"));
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Pi process fixture did not reach expected state"); await Bun.sleep(10); }
}
function cleanup(root: string) {
  for (const name of ["task", "leaf"]) if (existsSync(join(root, name))) { try { process.kill(pid(root, name), "SIGKILL"); } catch { /* stopped */ } }
  rmSync(root, { recursive: true, force: true });
}
function start(root: string, mode = "hang") {
  const task = launchPiProcess({ file: process.execPath, args: [fixture, "task", root, mode], cwd: root, env: process.env });
  task.stdout.resume(); task.stderr.resume(); task.stdin.end();
  return task;
}

describe.skipIf(process.platform !== "linux")("Pi native descendant supervision", () => {
  test("root exit resolves only after its escaped descendant is stopped, preserving the root status", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-root-exit-")), task = start(root, "exit");
    try {
      expect(await task.closed).toEqual({ code: 7, signal: null });
      expect(alive(pid(root, "task"))).toBe(false);
      expect(alive(pid(root, "leaf"))).toBe(false);
    } finally { task.kill("SIGKILL"); await task.closed.catch(() => {}); cleanup(root); }
  });

  test("kill requests full cleanup for any supplied signal and keeps the guardian alive to prove it", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-stop-")), task = start(root);
    try {
      await until(() => existsSync(join(root, "leaf")));
      task.kill("SIGTERM"); task.kill("SIGKILL");
      expect(await task.closed).toEqual({ code: null, signal: "SIGKILL" });
      expect(alive(pid(root, "leaf"))).toBe(false);
    } finally { task.kill("SIGKILL"); await task.closed.catch(() => {}); cleanup(root); }
  });

  test("guardian loss rejects closed with unknown evidence even when task pipes remain open", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-unknown-")), task = start(root);
    const closed = task.closed.then(() => null, error => error);
    try {
      await until(() => existsSync(join(root, "leaf")));
      process.kill(pid(root, "guardian"), "SIGKILL");
      const error = await closed;
      expect(error).toBeInstanceOf(ProcessStopUnknownError);
      expect(error.evidence).toMatchObject({ state: "unknown", treeClean: false });
      expect(alive(pid(root, "leaf"))).toBe(true);
    } finally { cleanup(root); }
  });

  test("loss of the Pi JS owner still stops its escaped descendants", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-owner-loss-"));
    const owner = spawn(process.execPath, [fixture, "owner", root, "hang"], { stdio: "ignore" });
    const exited = new Promise(resolve => owner.once("exit", resolve));
    try {
      await until(() => existsSync(join(root, "leaf")));
      owner.kill("SIGKILL"); await exited;
      await until(() => !alive(pid(root, "task")) && !alive(pid(root, "leaf")));
    } finally { owner.kill("SIGKILL"); cleanup(root); }
  });
});
