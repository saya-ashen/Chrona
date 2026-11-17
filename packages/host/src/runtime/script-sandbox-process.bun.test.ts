import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProcessHelper } from "../../../process/scripts/build-helper";
import { createScriptSandbox, ProcessStopUnknownError } from "./script-sandbox";

let buildDir: string, helper: string;
beforeAll(() => {
  if (process.platform !== "linux") return;
  buildDir = mkdtempSync(join(tmpdir(), "chrona-sandbox-process-build-"));
  helper = buildProcessHelper(join(buildDir, "guardian"));
});
afterAll(() => { if (buildDir) rmSync(buildDir, { recursive: true, force: true }); });
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
const body = `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
writeFileSync(process.env.CHRONA_DATA + "/task", String(process.pid));
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
writeFileSync(process.env.CHRONA_DATA + "/child", String(child.pid));
`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-sandbox-process-")), codeDir = join(root, "code"), dataDir = join(root, "data");
  mkdirSync(codeDir); mkdirSync(dataDir);
  return { root, codeDir, dataDir };
}
function cleanup(root: string, dataDir: string) {
  for (const name of ["task", "child"]) if (existsSync(join(dataDir, name))) { try { process.kill(Number(readFileSync(join(dataDir, name), "utf8")), "SIGKILL"); } catch { /* exited */ } }
  rmSync(root, { recursive: true, force: true });
}

test("missing native backend reports unavailable instead of silently launching unsupervised", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.codeDir, "test.ts"), "console.log('must not run')");
    const sandbox = createScriptSandbox({ processHelper: "/no/such/native/guardian" });
    expect(sandbox.health).toEqual({ available: false, isolated: false });
    expect(await sandbox.runModule({ ...f, entry: "test.ts", input: {} })).toMatchObject({ status: "unavailable", output: "" });
  } finally { cleanup(f.root, f.dataDir); }
});

describe.skipIf(process.platform !== "linux")("sandbox native supervision without IPC or model calls", () => {
  for (const mode of ["exit", "timeout"] as const) test(`${mode} removes an escaped descendant before returning a result`, async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.codeDir, "test.ts"), body + (mode === "exit" ? "process.exit(0);" : "setInterval(() => {}, 1000);"));
      const sandbox = createScriptSandbox({ processHelper: helper });
      const result = await sandbox.runModule({ ...f, entry: "test.ts", input: {}, timeoutMs: 300 });
      expect(result).toMatchObject({ status: mode === "exit" ? "succeeded" : "timed_out", stopEvidence: { state: "stopped", scope: "descendants", treeClean: true } });
      expect(alive(Number(readFileSync(join(f.dataDir, "child"), "utf8")))).toBe(false);
      expect(existsSync(join(f.dataDir, ".host-stops"))).toBe(false);
    } finally { cleanup(f.root, f.dataDir); }
  });

  test("application stop evidence stays outside business data", async () => {
    const f = fixture(), record = join(f.root, "launch.json");
    try {
      writeFileSync(join(f.codeDir, "index.ts"), `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ path: process.env.CHRONA_HOST_STOP_RECEIPT, generation: process.env.CHRONA_HOST_GENERATION }));`);
      const sandbox = createScriptSandbox({ dataDir: f.root, processHelper: helper });
      const child = sandbox.startModule({ ...f, entry: "index.ts", ipcEndpoint: "tcp://127.0.0.1:1", ipcToken: "a".repeat(64) });
      await child.exited;
      const launch = JSON.parse(readFileSync(record, "utf8")) as { path: string; generation: string };
      expect(launch.path).toBe(join(f.root, "platform", "host-stops", `${launch.generation}.json`));
      expect(JSON.parse(readFileSync(launch.path, "utf8"))).toMatchObject({ generation: launch.generation, state: "stopped", scope: "descendants", treeClean: true });
      expect(existsSync(join(f.dataDir, ".host-stops"))).toBe(false);
    } finally { cleanup(f.root, f.dataDir); }
  });

  test("guardian loss rejects with unknown stop instead of returning a successful script result", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.codeDir, "test.ts"), body + "setInterval(() => {}, 1000);");
      const sandbox = createScriptSandbox({ processHelper: helper });
      const result = sandbox.runModule({ ...f, entry: "test.ts", input: {}, timeoutMs: 3000 });
      // Discover this test's guardian through the task's PPid; no production API
      // exposes task cancellation as an unsafe direct-PID kill.
      const deadline = Date.now() + 3000;
      while (!existsSync(join(f.dataDir, "child"))) {
        if (Date.now() > deadline) throw new Error("module did not start");
        await Bun.sleep(5);
      }
      const taskPid = Number(readFileSync(join(f.dataDir, "task"), "utf8"));
      const guardian = Number(readFileSync(`/proc/${taskPid}/status`, "utf8").match(/^PPid:\s+(\d+)$/m)![1]);
      expect(readFileSync(`/proc/${guardian}/cmdline`, "utf8").split("\0")[0]).toBe(helper);
      process.kill(guardian, "SIGKILL");
      await expect(result).rejects.toBeInstanceOf(ProcessStopUnknownError);
    } finally { cleanup(f.root, f.dataDir); }
  });
});
