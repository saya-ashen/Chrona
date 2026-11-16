import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { inspectPiLaunch, piEnvironment, piLaunchConfig, PI_MODEL_ENVIRONMENT_KEYS, type PiProviderOptions } from "./pi-launch";
import type { PiProcess, PiProcessInput } from "./pi-process";

async function fixture(mode = "normal") {
  const dir = await mkdtemp(join(tmpdir(), "pi-probe-")), agentDir = await mkdtemp(join(tmpdir(), "pi-probe-profile-"));
  const command = join(dir, "pi"), extension = join(dir, "extension.ts");
  await writeFile(extension, "");
  await writeFile(command, `#!${process.execPath}
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
const root = ${JSON.stringify(dir)}, mode = ${JSON.stringify(mode)};
writeFileSync(root+'/probe.json', JSON.stringify({ cwd: process.cwd(), profile: process.env.PI_CODING_AGENT_DIR, envKeys: Object.keys(process.env) }));
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
  // A real process closes after its output has been delivered, even for an immediate exit.
  const drained = closed.then(async result => { await new Promise<void>(resolve => setImmediate(resolve)); return result; });
  return { stdin: new PassThrough(), stdout, stderr: new PassThrough(), closed: drained, kill() {} };
}

test("health shares a successful version probe while launch admission and changed inputs probe afresh", async () => {
  const f = await fixture();
  let probes = 0;
  const launch = () => { probes++; return controlledProbe(Promise.resolve({ code: 0, signal: null })); };
  const options = { ...f.options, launch };
  try {
    const config = piLaunchConfig(options);
    expect(await Promise.all([inspectPiLaunch(config, true), inspectPiLaunch(config, true)])).toEqual([null, null]);
    // Health constructs a new adapter each time; reuse must survive a new config object.
    expect(await inspectPiLaunch(piLaunchConfig(options), true)).toBeNull();
    expect(probes).toBe(1);
    expect(await inspectPiLaunch(config)).toBeNull();
    expect(probes).toBe(2);
    expect(await inspectPiLaunch(piLaunchConfig({ ...options, chronaExtension: join(f.dir, "missing") }), true)).toContain("extension missing");
    expect(probes).toBe(2);
    await writeFile(f.options.command!, "changed executable");
    expect(await inspectPiLaunch(config, true)).toBeNull();
    expect(probes).toBe(3);
    expect(await inspectPiLaunch(piLaunchConfig({ ...options, expectedVersion: "1.3.8" }), true)).toContain("version does not match");
    expect(probes).toBe(4);
  } finally { await f.cleanup(); }
});

test.skipIf(process.platform === "win32")("health reports an unavailable executable for a symlink loop", async () => {
  const f = await fixture();
  try {
    const command = join(f.dir, "loop"); await symlink(command, command);
    expect(await inspectPiLaunch(piLaunchConfig({ ...f.options, command }), true)).not.toBeNull();
  } finally { await f.cleanup(); }
});

test("health version success expires and failures are immediately retried", async () => {
  const f = await fixture();
  let probes = 0, available = true;
  const launch = () => { probes++; return controlledProbe(Promise.resolve({ code: available ? 0 : 1, signal: null })); };
  const config = piLaunchConfig({ ...f.options, launch });
  const clock = spyOn(Date, "now");
  const now = Date.now(); clock.mockReturnValue(now);
  try {
    expect(await inspectPiLaunch(config, true)).toBeNull();
    clock.mockReturnValue(now + 30_001); available = false;
    expect(await inspectPiLaunch(config, true)).toContain("unavailable");
    expect(await inspectPiLaunch(config, true)).toContain("unavailable");
    available = true;
    expect(await inspectPiLaunch(config, true)).toBeNull();
    expect(probes).toBe(4);
  } finally { clock.mockRestore(); await f.cleanup(); }
});

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

function restoreEnvironment(previous: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

test("profile precedence is explicit option, inherited Pi directory, then HOME default", async () => {
  const f = await fixture();
  const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  try {
    process.env.HOME = f.dir;
    process.env.PI_CODING_AGENT_DIR = f.options.agentDir;
    const explicit = piLaunchConfig({ ...f.options, agentDir: f.dir });
    expect(explicit.agentDir).toBe(f.dir); expect(explicit.agentDirSource).toBe("option");
    expect(piEnvironment(explicit).PI_CODING_AGENT_DIR).toBe(f.dir);
    expect(PI_MODEL_ENVIRONMENT_KEYS).toContain("PI_CODING_AGENT_DIR");
    const inherited = piLaunchConfig({ ...f.options, agentDir: undefined });
    expect(inherited.agentDir).toBe(f.options.agentDir!); expect(inherited.agentDirSource).toBe("environment");
    expect(piEnvironment(inherited).PI_CODING_AGENT_DIR).toBe(f.options.agentDir!);
    delete process.env.PI_CODING_AGENT_DIR;
    const normal = piLaunchConfig({ ...f.options, agentDir: undefined });
    expect(normal.agentDir).toBe(join(f.dir, ".pi", "agent")); expect(normal.agentDirSource).toBe("default");
    delete process.env.HOME;
    const fallback = piLaunchConfig({ ...f.options, agentDir: undefined });
    expect(fallback.agentDir).toBe(join(homedir(), ".pi", "agent"));
    expect(piEnvironment(fallback).HOME).toBe(homedir());
  } finally { restoreEnvironment(previous); await f.cleanup(); }
});

test.skipIf(process.platform !== "linux")("missing normal profile probes from HOME without creating a profile or inheriting host secrets", async () => {
  const f = await fixture();
  const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, CHRONA_DATABASE_SECRET: process.env.CHRONA_DATABASE_SECRET, NODE_OPTIONS: process.env.NODE_OPTIONS };
  try {
    process.env.HOME = f.dir; delete process.env.PI_CODING_AGENT_DIR;
    process.env.CHRONA_DATABASE_SECRET = "fixture-host-secret"; process.env.NODE_OPTIONS = "--trace-warnings";
    const config = piLaunchConfig({ ...f.options, agentDir: undefined });
    expect(await inspectPiLaunch(config)).toBeNull();
    const record = JSON.parse(await readFile(join(f.dir, "probe.json"), "utf8")) as { cwd: string; profile: string; envKeys: string[] };
    expect(record.cwd).toBe(f.dir); expect(record.profile).toBe(join(f.dir, ".pi", "agent"));
    expect(record.envKeys).not.toContain("CHRONA_DATABASE_SECRET"); expect(record.envKeys).not.toContain("NODE_OPTIONS");
    expect(existsSync(config.agentDir)).toBe(false);
    expect((await readdir(f.dir)).some(name => name.startsWith("chrona-pi-"))).toBe(false);
  } finally { restoreEnvironment(previous); await f.cleanup(); }
});

test("an existing normal profile uses Pi's usual directory permissions", async () => {
  const f = await fixture();
  const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  let called: PiProcessInput | undefined;
  try {
    process.env.HOME = f.dir; delete process.env.PI_CODING_AGENT_DIR;
    const profile = join(f.dir, ".pi", "agent"); await mkdir(profile, { recursive: true }); await chmod(profile, 0o755);
    const config = piLaunchConfig({ ...f.options, agentDir: undefined, launch(value) { called = value; return controlledProbe(Promise.resolve({ code: 0, signal: null })); } });
    expect(await inspectPiLaunch(config)).toBeNull(); expect(called?.cwd).toBe(profile);
    expect(called?.env.PI_CODING_AGENT_DIR).toBe(profile);
  } finally { restoreEnvironment(previous); await f.cleanup(); }
});

test("explicit and environment-selected profiles require canonical directories and accept normal Pi permissions", async () => {
  const f = await fixture();
  const previous = process.env.PI_CODING_AGENT_DIR;
  let probes = 0;
  const launch = () => { probes++; return controlledProbe(Promise.resolve({ code: 0, signal: null })); };
  try {
    const link = join(f.dir, "profile-link"); await symlink(f.options.agentDir!, link, "dir");
    for (const directory of ["relative-profile", join(f.dir, "missing-profile"), f.options.chronaExtension, link]) {
      expect(await inspectPiLaunch(piLaunchConfig({ ...f.options, agentDir: directory, launch }))).toContain("canonical directory");
      process.env.PI_CODING_AGENT_DIR = directory;
      expect(await inspectPiLaunch(piLaunchConfig({ ...f.options, agentDir: undefined, launch }))).toContain("canonical directory");
    }
    expect(probes).toBe(0);
    if (process.platform !== "win32") {
      await chmod(f.options.agentDir!, 0o755);
      expect(await inspectPiLaunch(piLaunchConfig({ ...f.options, launch }))).toBeNull();
      process.env.PI_CODING_AGENT_DIR = f.options.agentDir!;
      expect(await inspectPiLaunch(piLaunchConfig({ ...f.options, agentDir: undefined, launch }))).toBeNull();
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await f.cleanup();
  }
});

test("absolute executable, supported version, extension and separate workspace checks precede probing", async () => {
  const f = await fixture();
  let probes = 0;
  const launch = () => { probes++; return controlledProbe(Promise.resolve({ code: 0, signal: null })); };
  try {
    for (const [override, message] of [
      [{ command: "pi" }, "absolute"],
      [{ expectedVersion: "2.0.0" }, "Unsupported Pi version pin"],
      [{ chronaExtension: join(f.dir, "missing-extension") }, "Chrona tools extension missing"],
      [{ workspaceRoot: f.options.agentDir }, "separate from the session workspace"],
    ] as const) expect(await inspectPiLaunch(piLaunchConfig({ ...f.options, ...override, launch }))).toContain(message);
    expect(probes).toBe(0);
    expect(await inspectPiLaunch(piLaunchConfig({ ...f.options, expectedVersion: "1.3.8", launch }))).toBe("Pi version does not match the configured pin");
  } finally { await f.cleanup(); }
});

test("Pi environment preserves model credentials while filtering host capabilities and injection settings", async () => {
  const f = await fixture();
  const previous = Object.fromEntries(["OPENAI_API_KEY", "SSL_CERT_FILE", "CHRONA_AGENT_TOKEN", "CHRONA_DATABASE_SECRET", "NODE_OPTIONS", "BUN_OPTIONS", "PI_CODING_AGENT_DIR"].map(key => [key, process.env[key]]));
  try {
    process.env.OPENAI_API_KEY = "fixture-model-key"; process.env.SSL_CERT_FILE = "/fixture/cert.pem";
    process.env.CHRONA_AGENT_TOKEN = "fixture-run-token"; process.env.CHRONA_DATABASE_SECRET = "fixture-db-key";
    process.env.NODE_OPTIONS = "--trace-warnings"; process.env.BUN_OPTIONS = "--preload /fixture/inject.ts";
    process.env.PI_CODING_AGENT_DIR = "/ignored-profile";
    const env = piEnvironment(piLaunchConfig(f.options));
    expect(env.OPENAI_API_KEY).toBe("fixture-model-key"); expect(env.SSL_CERT_FILE).toBe("/fixture/cert.pem");
    expect(env.PI_CODING_AGENT_DIR).toBe(f.options.agentDir!);
    for (const key of ["CHRONA_AGENT_TOKEN", "CHRONA_DATABASE_SECRET", "NODE_OPTIONS", "BUN_OPTIONS"]) expect(env[key]).toBeUndefined();
  } finally { restoreEnvironment(previous); await f.cleanup(); }
});
