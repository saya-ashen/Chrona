import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { inspectPiLaunch, piLaunchConfig, type PiProviderOptions } from "./pi-launch";
import type { PiProcess, PiProcessInput } from "./pi-process";

async function fixture(mode = "normal") {
  const dir = await mkdtemp(join(tmpdir(), "pi-probe-")), agentDir = await mkdtemp(join(tmpdir(), "pi-probe-profile-"));
  const command = join(dir, "pi"), extension = join(dir, "extension.ts");
  await writeFile(extension, "");
  await writeFile(command, `#!${process.execPath}
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
const root = ${JSON.stringify(dir)}, mode = ${JSON.stringify(mode)};
writeFileSync(root+'/task', String(process.pid));
writeFileSync(root+'/guardian', String(process.ppid));
spawn(process.execPath, [${JSON.stringify(join(import.meta.dir, "pi-process.fixture.ts"))}, 'leaf', root, mode], { detached:true, stdio:'inherit' });
while(!existsSync(root+'/leaf')) await Bun.sleep(5);
console.log('1.3.9');
if(mode==='normal') process.exit(0);
if(mode==='unknown') process.kill(process.ppid, 'SIGKILL');
setInterval(()=>{},1000);
`, { mode: 0o755 });
  const options: PiProviderOptions = { command, agentDir, expectedVersion: "1.3.9", chronaExtension: extension, agentUrl: "" };
  const pid = async (name: string) => Number(await readFile(join(dir, name), "utf8"));
  const cleanup = async () => {
    for (const name of ["task", "leaf"]) { try { process.kill(await pid(name), "SIGKILL"); } catch { /* stopped or never launched */ } }
    await rm(dir, { recursive: true, force: true }); await rm(agentDir, { recursive: true, force: true });
  };
  return { dir, options, pid, cleanup };
}

for (const mode of ["normal", "hang", "unknown"]) test.skipIf(process.platform !== "linux")(`version probe cleans descendants or fails closed: ${mode}`, async () => {
  const f = await fixture(mode), started = Date.now();
  try {
    const error = await inspectPiLaunch(piLaunchConfig(f.options));
    if (mode === "normal") expect(error).toBeNull();
    else expect(error).not.toBeNull();
    if (mode === "hang") {
      expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
      expect(Date.now() - started).toBeLessThan(4500);
    }
    if (mode === "unknown") expect(error).toContain("Process stop unknown");
    // Guardian loss cannot prove descendant death; normal exit and timeout must.
    if (mode !== "unknown") {
      const leaf = await f.pid("leaf");
      expect(() => process.kill(leaf, 0)).toThrow();
    }
  } finally { await f.cleanup(); }
});

function controlledProbe(closed: PiProcess["closed"]): PiProcess {
  const stdout = new PassThrough(); stdout.end("1.3.9\n");
  return { stdin: new PassThrough(), stdout, stderr: new PassThrough(), closed, kill() {} };
}

test("health uses the trusted custom launcher and waits for its closure proof even without a local helper", async () => {
  const f = await fixture();
  const previous = process.env.CHRONA_PROCESS_HELPER;
  let confirm!: () => void, called: PiProcessInput | undefined;
  const proof = new Promise<{ code: number; signal: null }>(resolve => { confirm = () => resolve({ code: 0, signal: null }); });
  process.env.CHRONA_PROCESS_HELPER = join(f.dir, "missing-helper");
  try {
    const defaultError = await inspectPiLaunch(piLaunchConfig(f.options));
    expect(defaultError).toContain("guardian missing");
    const checking = inspectPiLaunch(piLaunchConfig({ ...f.options, launch(input) { called = input; return controlledProbe(proof); } }));
    let finished = false;
    void checking.then(() => { finished = true; });
    await Bun.sleep(20);
    expect(called).toMatchObject({ file: f.options.command, args: ["--version"], cwd: f.options.agentDir, timeoutMs: 3000 });
    expect(called?.env.CHRONA_AGENT_TOKEN).toBeUndefined();
    expect(finished).toBe(false);
    confirm();
    expect(await checking).toBeNull();
  } finally {
    confirm?.();
    if (previous === undefined) delete process.env.CHRONA_PROCESS_HELPER; else process.env.CHRONA_PROCESS_HELPER = previous;
    await f.cleanup();
  }
});

test("a trusted custom launcher's unknown probe closure cannot report healthy", async () => {
  const f = await fixture();
  try {
    const error = await inspectPiLaunch(piLaunchConfig({ ...f.options, launch: () => controlledProbe(Promise.reject(new Error("remote stop unknown"))) }));
    expect(error).toBe("remote stop unknown");
  } finally { await f.cleanup(); }
});

test("a timed out custom probe requests stop and cannot report healthy after a zero exit", async () => {
  const f = await fixture();
  let stopped = false, close!: () => void;
  const closed = new Promise<{ code: number; signal: null }>(resolve => { close = () => resolve({ code: 0, signal: null }); });
  try {
    const error = await inspectPiLaunch(piLaunchConfig({ ...f.options, launch() {
      return { ...controlledProbe(closed), kill() { stopped = true; close(); } };
    } }));
    expect(stopped).toBe(true);
    expect(error).toBe("Pi binary unavailable or version probe timed out");
  } finally { close?.(); await f.cleanup(); }
});
