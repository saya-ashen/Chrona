import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiProvider } from "./pi-provider";
import { launchPiProcess } from "./pi-process";
import type { ProviderRunInput } from "@chrona/contracts/steward";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

/** Every executable is synthetic; no installed Pi, credentials, model or QQ. */
async function fixture(mode = "normal") {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-pi-lifecycle-"));
  const agentDir = await mkdtemp(join(tmpdir(), "chrona-pi-private-"));
  directories.push(cwd, agentDir);
  const command = join(cwd, "fake-pi"), extension = join(cwd, "bridge.ts"), web = join(cwd, "web.ts");
  await writeFile(extension, ""); await writeFile(web, "");
  await writeFile(command, `#!${process.execPath}
import {appendFileSync,writeFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)};
if(process.argv.includes('--version')){if(mode==='slow-version')await Bun.sleep(90);console.log(mode==='bad-version'?'9.9.9':mode==='version-1.3'?'1.3.0':mode==='version-1.4'?'1.4.0':'0.85.0');process.exit(0)}
writeFileSync('launch.json',JSON.stringify({args:process.argv.slice(2),agentDir:process.env.PI_CODING_AGENT_DIR}));
let streaming=false,compacting=false,queued=0,cycle=0,delayedState=false;
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const reply=(c,data={})=>emit({id:c.id,type:'response',command:c.type,success:true,data});
const mark=name=>writeFileSync(name,'true');
const end=()=>{streaming=false;emit({type:'agent_end'});mark('settled-'+cycle);emit({type:'agent_settled',aborted:mode==='aborted-settled'})};
function run(){
 streaming=true;cycle++;emit({type:'agent_start'});
 if(mode==='tool-hang'){emit({type:'tool_execution_start',toolName:'bash'});return;}
 if(['queued','clear-error','clear-hang'].includes(mode))return;
 if(mode.startsWith('ui-')){emit({type:'extension_ui_request',id:'fixture-ui',method:mode.slice(3),title:'Fixture only'});return;}
 setTimeout(()=>{
  streaming=false;emit({type:'agent_end',messages:[],willRetry:mode==='recovery-gap'||mode==='retry-gap'});
  if(mode==='unsettled-exit'){setTimeout(()=>process.exit(0),130);return;}
  if(mode==='settled-gap'){setTimeout(()=>{mark('settled-'+cycle);emit({type:'agent_settled'})},130);return;}
  if(mode==='recovery-gap'||mode==='retry-gap'){
   emit({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'Recoverable synthetic error'}});
   setTimeout(()=>{compacting=true;emit({type:mode==='recovery-gap'?'compaction_start':'auto_retry_start'})},50);
   setTimeout(()=>{compacting=false;emit({type:mode==='recovery-gap'?'compaction_end':'auto_retry_end',willRetry:true});streaming=true;emit({type:'agent_start'});mark('recovered')},90);
   setTimeout(end,130);return;
  }
  mark('settled-'+cycle);emit({type:'agent_settled',aborted:mode==='aborted-settled'});
 },30);
}
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))!==-1){
 const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);appendFileSync('commands.jsonl',JSON.stringify(c)+'\\n');
 if(c.type==='get_state'){
  const state={sessionId:'fixture-session',isStreaming:streaming,isCompacting:compacting,pendingMessageCount:queued};
  if(mode==='state-injection'&&cycle===1&&!streaming&&!delayedState){delayedState=true;setTimeout(()=>reply(c,state),110)}else reply(c,state);
 }
 if(c.type==='get_commands'){
  if(mode==='metadata-hang')continue;
  const commands=mode==='unexpected-command'?[{name:'foreign',source:'extension',path:'/not-approved.ts'}]:mode==='trusted-command'?[{name:'websearch',source:'extension',sourceInfo:{path:${JSON.stringify(web)}}}]:mode==='trusted-command-legacy'?[{name:'websearch',source:'extension',path:${JSON.stringify(web)}}]:[];
  reply(c,{commands});
 }
 if(c.type==='prompt'){reply(c);if(streaming&&c.streamingBehavior)queued++;else run();}
 if(c.type==='follow_up'||c.type==='steer'){queued++;reply(c);}
 if(c.type==='clear_queue'){
  if(mode==='clear-hang')continue;
  if(mode==='clear-error'){emit({id:c.id,type:'response',command:c.type,success:false,error:'Synthetic refusal'});continue;}
  queued=0;reply(c,{steering:[],followUp:[]});
 }
 if(c.type==='abort'){if(queued)mark('restarted-queued');reply(c);emit({type:'agent_settled',aborted:true});}
}});
process.stdin.on('end',()=>{setTimeout(()=>{mark('last-write');process.exit(0)},mode==='late-exit'?70:0)});
`, { mode: 0o755 });
  const options = { command, agentDir, expectedVersion: "0.85.0", chronaExtension: extension, webExtension: web, agentUrl: "http://127.0.0.1:1234/api/steward-agent" };
  const input: ProviderRunInput = { runId: "fixture", token: "synthetic-run-token", lane: "foreground", cwd, sessionDir: join(cwd, "sessions"), sessionId: null, systemPrompt: "Fixture instructions", resources: "configured", prompt: "Synthetic subprocess only", deadline: new Date(Date.now() + 3000) };
  const commands = async (): Promise<{ type: string }[]> => { try { return (await readFile(join(cwd, "commands.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
  const marked = async (name: string) => { try { await readFile(join(cwd, name)); return true; } catch { return false; } };
  return { cwd, agentDir, options, input, commands, marked, provider: createPiProvider(options) };
}
async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await Bun.sleep(10); }
  throw new Error("Fixture did not reach required state");
}

test.each(["settled-gap", "recovery-gap", "retry-gap"])("waits for session settlement across %s", async mode => {
  const f = await fixture(mode);
  expect((await f.provider.start(f.input).done).outcome).toBe("finished");
  expect(await f.marked("settled-1")).toBe(true);
  if (mode !== "settled-gap") expect(await f.marked("recovered")).toBe(true);
});
test("a new injection invalidates a delayed completion snapshot", async () => {
  const f = await fixture("state-injection"), handle = f.provider.start(f.input);
  await until(async () => (await f.commands()).filter(c => c.type === "get_state").length >= 2);
  await handle.inject("Latest persisted input");
  expect((await handle.done).outcome).toBe("finished");
  expect(await f.marked("settled-2")).toBe(true);
});
test("aborted settlement is not success and EOF without settlement is failure", async () => {
  for (const mode of ["aborted-settled", "unsettled-exit"]) {
    const f = await fixture(mode);
    expect((await f.provider.start(f.input).done).outcome).toBe("failed");
  }
});
test("a trusted launcher withholds done until owned process closure is confirmed", async () => {
  const f = await fixture();
  let confirm!: () => void;
  const proof = new Promise<void>(resolveProof => { confirm = resolveProof; });
  const provider = createPiProvider({ ...f.options, launch(input) {
    const process = launchPiProcess(input);
    if (input.args.includes("--version")) return process;
    return { ...process, closed: process.closed.then(async exit => { await proof; return exit; }) };
  } });
  const handle = provider.start(f.input);
  let completed = false;
  const done = handle.done.then(result => { completed = true; return result; });
  try {
    await until(() => f.marked("last-write"));
    await Bun.sleep(20);
    expect(completed).toBe(false);
  } finally { confirm(); }
  expect((await done).outcome).toBe("finished");
});

test("unknown launcher closure rejects done instead of publishing stopped completion", async () => {
  const f = await fixture();
  const uncertainty = new Error("Owned cgroup identity could not be verified");
  let profile = "";
  const provider = createPiProvider({ ...f.options, launch(input) {
    const process = launchPiProcess(input);
    if (input.args.includes("--version")) return process;
    profile = input.env.PI_CODING_AGENT_DIR!;
    return { ...process, closed: process.closed.then(() => { throw uncertainty; }) };
  } });
  const handle = provider.start(f.input);
  await expect(handle.done).rejects.toBe(uncertainty);
  expect(await f.marked("last-write")).toBe(true);
  await expect(handle.abort()).rejects.toBe(uncertainty);
  expect(profile).toBe(f.agentDir);
  expect((await stat(profile)).isDirectory()).toBe(true);
  expect(await readdir(profile)).toEqual([]);
});

test("done waits for the child's final write and exit", async () => {
  const f = await fixture("late-exit");
  expect((await f.provider.start(f.input).done).outcome).toBe("finished");
  expect(await f.marked("last-write")).toBe(true);
});
test.each(["queued", "clear-error", "clear-hang"])("cancel clears queues first or closes without reactivating them: %s", async mode => {
  const f = await fixture(mode), handle = f.provider.start(f.input);
  await until(async () => (await f.commands()).some(c => c.type === "prompt"));
  await handle.inject("Already persisted by Chrona");
  const cancelled = handle.abort();
  await expect(handle.inject("Too late")).rejects.toThrow();
  await cancelled;
  const commands = (await f.commands()).map(c => c.type);
  expect(commands).toContain("clear_queue");
  if (mode === "queued") expect(commands.indexOf("clear_queue")).toBeLessThan(commands.indexOf("abort"));
  else expect(commands).not.toContain("abort");
  expect(await f.marked("restarted-queued")).toBe(false);
  expect(await f.marked("last-write")).toBe(true);
});
test("deadline uses the same queue clearing without relabelling it as an explicit cancel", async () => {
  const f = await fixture("queued"), handle = f.provider.start({ ...f.input, deadline: new Date(Date.now() + 350) });
  await until(async () => (await f.commands()).some(c => c.type === "prompt"));
  await handle.inject("Persisted before timeout");
  expect((await handle.done).outcome).toBe("timed_out");
  expect((await f.commands()).map(c => c.type)).toContain("clear_queue");
  expect(await f.marked("restarted-queued")).toBe(false);
});
test("a Run without a deadline can finish normally", async () => {
  const f = await fixture();
  expect((await f.provider.start({ ...f.input, deadline: null }).done).outcome).toBe("finished");
  expect(await f.marked("settled-1")).toBe(true);
});
test("a silent Run without a deadline has no default idle cancellation and remains cancellable", async () => {
  const f = await fixture("queued");
  // Accelerate the former five-minute watchdog so this regression stays offline and fast.
  const schedule = globalThis.setTimeout;
  const accelerated = Object.assign((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay, ...values] = args;
    return schedule(callback, delay === 300_000 ? 40 : delay, ...values);
  }, schedule);
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(accelerated);
  const handle = f.provider.start({ ...f.input, deadline: null });
  let completed = false;
  void handle.done.then(() => { completed = true; });
  try {
    await until(async () => (await f.commands()).some(c => c.type === "prompt"));
    await Bun.sleep(150);
    expect(completed).toBe(false);
    await handle.inject("Persisted input during an unlimited Run");
    expect((await f.commands()).map(c => c.type)).not.toContain("clear_queue");
  } finally {
    timer.mockRestore();
    await handle.abort();
  }
  expect(await handle.done).toMatchObject({ outcome: "failed", error: "Pi run aborted" });
  expect((await f.commands()).map(c => c.type)).toContain("clear_queue");
  expect(await f.marked("last-write")).toBe(true);
});
test("a deadline beyond the timer range rearms instead of expiring early", async () => {
  const f = await fixture("queued"), schedule = globalThis.setTimeout;
  let chunks = 0, completed = false;
  const accelerated = Object.assign((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay, ...values] = args;
    if (delay === 2_147_483_647) chunks++;
    return schedule(callback, delay === 2_147_483_647 ? 40 : delay, ...values);
  }, schedule);
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(accelerated);
  const handle = f.provider.start({ ...f.input, deadline: new Date(Date.now() + 31_536_000_000) });
  void handle.done.then(() => { completed = true; });
  try {
    await until(async () => (await f.commands()).some(c => c.type === "prompt"));
    await Bun.sleep(130);
    expect(chunks).toBeGreaterThan(1);
    expect(completed).toBe(false);
    await handle.inject("Still within the explicit deadline");
  } finally { timer.mockRestore(); await handle.abort(); }
  expect((await handle.done).outcome).toBe("failed");
});
test("an explicit idle timeout still cancels a Run without a deadline", async () => {
  const f = await fixture("queued");
  const handle = createPiProvider({ ...f.options, idleTimeoutMs: 100 }).start({ ...f.input, deadline: null });
  expect(await handle.done).toMatchObject({ outcome: "timed_out", error: expect.stringContaining("Pi produced no output") });
  expect((await f.commands()).map(c => c.type)).toContain("clear_queue");
  expect(await f.marked("last-write")).toBe(true);
});
test("a silent model turn ends on the idle timeout, long before the deadline", async () => {
  const f = await fixture("queued"), started = Date.now();
  const result = await createPiProvider({ ...f.options, idleTimeoutMs: 200 }).start(f.input).done;
  expect(result).toMatchObject({ outcome: "timed_out", error: expect.stringContaining("Pi produced no output for 0s") });
  expect(Date.now() - started).toBeLessThan(2000);
  expect((await f.commands()).map(c => c.type)).toContain("clear_queue");
});
test("a long-running tool is not cut by the idle timeout", async () => {
  const f = await fixture("tool-hang");
  const result = await createPiProvider({ ...f.options, idleTimeoutMs: 100 }).start({ ...f.input, deadline: new Date(Date.now() + 700) }).done;
  expect(result).toMatchObject({ outcome: "timed_out", error: expect.stringContaining("Pi deadline exceeded") });
});
test("cancellation during preflight cannot start a late child", async () => {
  const f = await fixture("slow-version"), handle = f.provider.start(f.input);
  await handle.abort();
  expect((await handle.done).outcome).toBe("failed");
  expect(await f.marked("launch.json")).toBe(false);
});
test("cancel interrupts a stuck metadata handshake and rejects waiting injections", async () => {
  const f = await fixture("metadata-hang"), handle = f.provider.start(f.input);
  const injection = handle.inject("Must not bypass metadata").then(() => false, () => true);
  await until(async () => (await f.commands()).some(c => c.type === "get_commands"));
  await handle.abort(); expect(await injection).toBe(true);
  expect((await handle.done).outcome).toBe("failed");
  expect((await f.commands()).some(c => c.type === "prompt")).toBe(false);
});
test("uses the selected user profile without overriding resource approval", async () => {
  const f = await fixture();
  expect((await f.provider.start(f.input).done).outcome).toBe("finished");
  const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
  expect(launch.agentDir).toBe(f.agentDir);
  expect(launch.args).not.toContain("--no-approve");
  expect((await f.commands()).map(c => c.type)).not.toContain("set_auto_retry");
  expect((await f.commands()).map(c => c.type)).not.toContain("set_auto_compaction");
});
test.each(["unexpected-command", "trusted-command", "trusted-command-legacy"])("accepts full selected user resources including %s", async mode => {
  for (const resources of ["minimal", "configured"] as const) {
    const f = await fixture(mode);
    expect((await f.provider.start({ ...f.input, resources }).done).outcome).toBe("finished");
    const commands = (await f.commands()).map(c => c.type);
    expect(commands).toContain("get_commands");
    expect(commands.filter(type => type === "prompt")).toHaveLength(1);
    expect(commands).not.toContain("set_auto_retry");
    expect(commands).not.toContain("set_auto_compaction");
    const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
    expect(launch.agentDir).toBe(f.agentDir);
    expect(launch.args).toContain(f.options.webExtension);
    for (const flag of ["--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--tools"]) expect(launch.args).not.toContain(flag);
  }
});
test("rejects a version mismatch before model work", async () => {
  const f = await fixture("bad-version");
  expect((await f.provider.health()).available).toBe(false);
  expect((await f.provider.start(f.input).done).outcome).toBe("unavailable");
  expect(await f.marked("launch.json")).toBe(false);
});
test("accepts the default 0.85 pin and 1.x pins from 1.3, rejects unsupported pins", async () => {
  const legacy = await fixture(), modern = await fixture("version-1.3"), newer = await fixture("version-1.4");
  expect((await createPiProvider({ ...legacy.options, expectedVersion: undefined }).start(legacy.input).done).outcome).toBe("finished");
  expect((await createPiProvider({ ...modern.options, expectedVersion: "1.3.0" }).start(modern.input).done).outcome).toBe("finished");
  expect((await createPiProvider({ ...newer.options, expectedVersion: "1.4.0" }).start(newer.input).done).outcome).toBe("finished");
  for (const pin of ["9.9.9", "1.2.0", "2.0.0"]) expect((await createPiProvider({ ...legacy.options, expectedVersion: pin }).health()).available).toBe(false);
});
test("expired deadlines never start the Provider", async () => {
  const f = await fixture();
  expect((await f.provider.start({ ...f.input, deadline: new Date(Date.now() - 1) }).done).outcome).toBe("timed_out");
  expect(await f.marked("launch.json")).toBe(false);
});
test("still requires an explicit executable and rejects invalid explicit profiles", async () => {
  const f = await fixture();
  await symlink(f.options.command, join(f.cwd, "pi"));
  const previous = process.env.PATH; process.env.PATH = f.cwd;
  try {
    const provider = createPiProvider({ ...f.options, command: undefined });
    expect((await provider.health()).available).toBe(false);
    expect((await provider.start(f.input).done).outcome).toBe("unavailable");
    expect(await f.marked("launch.json")).toBe(false);
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
  for (const agentDir of ["relative-profile", join(f.cwd, "missing")]) {
    const provider = createPiProvider({ ...f.options, agentDir });
    expect((await provider.health()).available).toBe(false);
    expect((await provider.start(f.input).done).outcome).toBe("unavailable");
  }
});
test.each(["option", "environment", "default", "missing-default"])("selects the %s user profile with a fake executable", async source => {
  const f = await fixture();
  const fakeHome = await mkdtemp(join(tmpdir(), "chrona-pi-home-"));
  directories.push(fakeHome);
  const defaultProfile = join(fakeHome, ".pi", "agent");
  if (source !== "missing-default") await mkdir(defaultProfile, { recursive: true });
  const previousHome = process.env.HOME, previousProfile = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = fakeHome;
  if (source === "default" || source === "missing-default") delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = source === "option" ? join(fakeHome, "unselected-profile") : f.agentDir;
  try {
    const provider = createPiProvider({ ...f.options, agentDir: source === "option" ? f.agentDir : undefined });
    expect((await provider.health()).available).toBe(true);
    expect((await provider.start(f.input).done).outcome).toBe("finished");
    const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
    expect(launch.agentDir).toBe(source === "option" || source === "environment" ? f.agentDir : defaultProfile);
    expect(launch.args).not.toContain("--no-approve");
    if (source === "missing-default") await expect(stat(defaultProfile)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousProfile;
  }
});
test("refuses profile symlinks and profile/workspace overlap", async () => {
  const f = await fixture(), link = join(f.cwd, "profile-link"); await symlink(f.agentDir, link);
  for (const options of [{ agentDir: link }, { agentDir: f.cwd, workspaceRoot: f.cwd }]) {
    expect((await createPiProvider({ ...f.options, ...options }).health()).available).toBe(false);
  }
});
test.skipIf(process.platform === "win32")("uses an explicitly selected normal user profile with group-readable permissions", async () => {
  const f = await fixture(); await chmod(f.agentDir, 0o755);
  expect((await f.provider.health()).available).toBe(true);
  expect((await f.provider.start(f.input).done).outcome).toBe("finished");
  expect(await f.marked("launch.json")).toBe(true);
});
test.each(["select", "confirm", "input", "editor"])("unbridged %s fails explicitly rather than silently approving or waiting for deadline", async method => {
  const f = await fixture(`ui-${method}`);
  const result = await f.provider.start(f.input).done;
  expect(result.outcome).toBe("failed");
  expect(result.error).toContain("interaction");
  expect((await f.commands()).some(c => c.type === "extension_ui_response")).toBe(false);
});
