import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProcessHelper } from "../../../process/scripts/build-helper";
import { createLoopbackChannel } from "./module-sdk/transport";

const linux = process.platform === "linux";
let buildDir: string, helperPath: string;
beforeAll(async () => {
  if (!linux) return;
  buildDir = await mkdtemp(join(tmpdir(), "chrona-sdk-guardian-"));
  helperPath = buildProcessHelper(join(buildDir, "guardian"));
});
afterAll(async () => { if (buildDir) await rm(buildDir, { recursive: true, force: true }); });

async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(5);
  }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function descendants(root: string) {
  return ["task", "middle", "leaf"].filter(name => existsSync(join(root, name))).map(name => Number(readFileSync(join(root, name), "utf8")));
}
type Result = { output?: { code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }; error?: { name: string; message: string } };
async function fixture(config: { action?: string; code?: string; options?: Record<string, unknown> }, helper = helperPath) {
  const root = await mkdtemp(join(tmpdir(), "chrona-sdk-exec-"));
  await cp(join(import.meta.dirname, "module-sdk"), join(root, "sdk"), { recursive: true });
  const channel = await createLoopbackChannel({ onMessage(value) {
    const call = value as { id: string; params: { target: string } };
    const output = call.params.target === "secrets.token" ? { accessToken: "synthetic-oauth-private" } : { value: { password: "synthetic-password-private" } };
    channel.send({ id: call.id, result: { output } });
  } });
  const owner = spawn(process.execPath, [join(import.meta.dirname, "module-sdk-exec.fixture.ts"), "sdk", root, JSON.stringify(config)], {
    env: { ...process.env, CHRONA_IPC_ENDPOINT: channel.endpoint, CHRONA_IPC_TOKEN: channel.token, CHRONA_HTTP_TOKEN: "synthetic-http-private", CHRONA_HTTP_ENDPOINT: "http://127.0.0.1:1", CHRONA_PROCESS_HELPER: helper },
    stdio: "ignore",
  });
  const exited = new Promise<void>(resolve => owner.once("close", () => resolve()));
  return {
    root, owner, channel, exited,
    async result(): Promise<Result> {
      await until(() => existsSync(join(root, "result.json")), "SDK exec did not settle");
      return JSON.parse(await readFile(join(root, "result.json"), "utf8")) as Result;
    },
    async cleanup() {
      owner.kill("SIGKILL"); await exited; await channel.close();
      // Unknown guardian-stop tests deliberately leave live tasks; never leak fixtures.
      for (const pid of descendants(root)) { try { process.kill(pid, "SIGKILL"); } catch { /* already stopped */ } }
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("SDK-private process resource matches the authoritative process API", async () => {
  expect(await readFile(join(import.meta.dirname, "module-sdk/process.ts"), "utf8")).toBe(await readFile(join(import.meta.dirname, "../../../process/src/index.ts"), "utf8"));
});

describe.skipIf(!linux)("SDK exec descendant supervision in a copied standalone SDK", () => {
  for (const action of ["exit", "timeout", "cancel"] as const) test(`${action} waits for setsid descendants before settling`, async () => {
    const probe = await fixture({ action, options: { timeoutMs: action === "timeout" ? 1000 : 4000 } });
    try {
      const result = await probe.result();
      expect(descendants(probe.root)).toHaveLength(3);
      expect(descendants(probe.root).some(alive)).toBe(false);
      if (action === "cancel") expect(result).toEqual({ error: { name: "Error", message: "Fixture cancelled" } });
      else expect(result.output).toMatchObject({ code: action === "exit" ? 7 : null, signal: action === "exit" ? null : "SIGKILL", timedOut: action === "timeout" });
    } finally { await probe.cleanup(); }
  });

  test("IPC disconnect requests stop and waits for descendants", async () => {
    const probe = await fixture({ action: "wait" });
    try {
      await until(() => existsSync(join(probe.root, "leaf")), "tree did not start");
      await probe.channel.close();
      expect(await probe.result()).toEqual({ error: { name: "Error", message: "Chrona disconnected" } });
      expect(descendants(probe.root).some(alive)).toBe(false);
    } finally { await probe.cleanup(); }
  });

  test("SDK owner SIGKILL still stops escaped descendants", async () => {
    const probe = await fixture({ action: "wait" });
    try {
      await until(() => existsSync(join(probe.root, "leaf")), "tree did not start");
      const pids = descendants(probe.root);
      expect(pids).toHaveLength(3);
      probe.owner.kill("SIGKILL"); await probe.exited;
      await until(() => pids.every(pid => !alive(pid)), "owner death left descendants alive");
    } finally { await probe.cleanup(); }
  });

  test("guardian death rejects unknown stop instead of returning success", async () => {
    const probe = await fixture({ action: "guardian-death" });
    try {
      expect((await probe.result()).error).toMatchObject({ name: "ProcessStopUnknownError" });
      expect(descendants(probe.root).some(alive)).toBe(true);
    } finally { await probe.cleanup(); }
  });

  test("a helper exiting zero without stop evidence cannot produce success", async () => {
    const helper = join(buildDir, "no-stop-evidence");
    await writeFile(helper, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const probe = await fixture({ action: "wait" }, helper);
    try {
      const result = await probe.result();
      expect(result.error).toMatchObject({ name: "ProcessStopUnknownError" });
      expect(result.output).toBeUndefined();
      expect(descendants(probe.root)).toEqual([]);
    } finally { await probe.cleanup(); }
  });

  test("missing helper fails closed before launching a command", async () => {
    const probe = await fixture({ action: "wait" }, "/missing/chrona-process-guardian");
    try {
      expect((await probe.result()).error).toMatchObject({ name: "ProcessSupervisionUnavailableError" });
      expect(descendants(probe.root)).toEqual([]);
    } finally { await probe.cleanup(); }
  });

  test("a command that intentionally exits 127 remains a completed command", async () => {
    const probe = await fixture({ code: "process.exit(127)" });
    try { expect(await probe.result()).toMatchObject({ output: { code: 127, timedOut: false } }); }
    finally { await probe.cleanup(); }
  });

  test("control credentials and caller helper overrides never reach the exec child", async () => {
    const probe = await fixture({ code: 'console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("CHRONA_IPC_") || key.startsWith("CHRONA_HTTP_") || key === "CHRONA_PROCESS_HELPER")))); console.log(process.env.PLAIN)', options: {
      env: { CHRONA_IPC_TOKEN: "override", CHRONA_HTTP_TOKEN: "override", CHRONA_PROCESS_HELPER: "/untrusted/helper", PLAIN: "plain" },
      secretEnv: { CHRONA_IPC_ENDPOINT: { secret: "fixture", field: "password" } },
      tokenEnv: { CHRONA_HTTP_CREDENTIAL: { secret: "fixture", provider: "google" } },
    } });
    try { expect((await probe.result()).output).toMatchObject({ code: 0, stdout: "{}\nplain\n" }); }
    finally { await probe.cleanup(); }
  });

  test("secret redaction, stdin and independent output limits survive supervision", async () => {
    const probe = await fixture({ code: 'const fs = require("node:fs"); process.stdout.write(fs.readFileSync(0, "utf8") + process.env.PASS); process.stderr.write("123456789");', options: {
      stdin: "input ", maxOutputBytes: 18, secretEnv: { PASS: { secret: "fixture", field: "password" } },
    } });
    try { expect((await probe.result()).output).toMatchObject({ code: 0, stdout: "input [redacted]", stderr: "123456789", truncated: true }); }
    finally { await probe.cleanup(); }
  });

  test("secret files are removed only after escaped descendants have stopped", async () => {
    const probe = await fixture({ action: "exit", options: {
      secretFiles: { PASS_FILE: { secret: "fixture", field: "password" } },
    } });
    try {
      const result = await probe.result();
      expect(result.output?.code).toBe(7);
      expect(descendants(probe.root)).toHaveLength(3);
      expect(descendants(probe.root).some(alive)).toBe(false);
      const [path, value] = result.output!.stdout.trim().split("\n");
      expect(value).toBe("[redacted]");
      expect(existsSync(path!)).toBe(false);
    } finally { await probe.cleanup(); }
  });
});
