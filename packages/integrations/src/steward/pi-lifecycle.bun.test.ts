import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiProvider } from "./pi-provider";
import type { ProviderRunInput } from "@chrona/contracts/steward";

/** Every executable is synthetic; no installed Pi, credentials, model or QQ. */
async function fixture(mode = "normal") {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-pi-lifecycle-"));
  const agentDir = await mkdtemp(join(tmpdir(), "chrona-pi-private-"));
  const command = join(cwd, "fake-pi"), extension = join(cwd, "bridge.ts"), web = join(cwd, "web.ts");
  await writeFile(extension, ""); await writeFile(web, "");
  await writeFile(command, `#!${process.execPath}
import {appendFileSync,writeFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)};
if(process.argv.includes('--version')){if(mode==='slow-version')await Bun.sleep(90);console.log(mode==='bad-version'?'9.9.9':mode==='version-1.3'?'1.3.0':'0.85.0');process.exit(0)}
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
  const input: ProviderRunInput = { runId: "fixture", token: "synthetic-run-token", lane: "foreground", cwd, sessionDir: join(cwd, "sessions"), sessionId: null, prompt: "Synthetic subprocess only", deadline: new Date(Date.now() + 3000) };
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
test("uses the dedicated profile and denies project resource trust", async () => {
  const f = await fixture();
  expect((await f.provider.start(f.input).done).outcome).toBe("finished");
  const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
  expect(launch.agentDir).toBe(f.agentDir);
  expect(launch.args).toContain("--no-approve");
});
test("unexpected command resources fail before any model prompt; explicitly loaded resources pass", async () => {
  const rejected = await fixture("unexpected-command"), handle = rejected.provider.start(rejected.input);
  const injection = handle.inject("Must wait for resource validation").then(() => false, () => true);
  expect((await handle.done).outcome).toBe("unavailable");
  expect(await injection).toBe(true);
  expect((await rejected.commands()).some(c => ["prompt", "steer", "follow_up"].includes(c.type))).toBe(false);
  for (const mode of ["trusted-command", "trusted-command-legacy"]) {
    const allowed = await fixture(mode);
    expect((await allowed.provider.start(allowed.input).done).outcome).toBe("finished");
  }
});
test("rejects a version mismatch before model work", async () => {
  const f = await fixture("bad-version");
  expect((await f.provider.health()).available).toBe(false);
  expect((await f.provider.start(f.input).done).outcome).toBe("unavailable");
  expect(await f.marked("launch.json")).toBe(false);
});
test("accepts the default 0.85 pin and explicit 1.3 pin, rejects unsupported pins", async () => {
  const legacy = await fixture(), modern = await fixture("version-1.3");
  expect((await createPiProvider({ ...legacy.options, expectedVersion: undefined }).start(legacy.input).done).outcome).toBe("finished");
  expect((await createPiProvider({ ...modern.options, expectedVersion: "1.3.0" }).start(modern.input).done).outcome).toBe("finished");
  expect((await createPiProvider({ ...legacy.options, expectedVersion: "9.9.9" }).health()).available).toBe(false);
});
test("expired deadlines never start the Provider", async () => {
  const f = await fixture();
  expect((await f.provider.start({ ...f.input, deadline: new Date(Date.now() - 1) }).done).outcome).toBe("timed_out");
  expect(await f.marked("launch.json")).toBe(false);
});
test("does not fall back to PATH or a shared profile when configuration is missing", async () => {
  const f = await fixture();
  await symlink(f.options.command, join(f.cwd, "pi"));
  const previous = process.env.PATH; process.env.PATH = f.cwd;
  try { expect((await createPiProvider({ ...f.options, command: undefined }).health()).available).toBe(false); }
  finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
  for (const agentDir of [undefined, "relative-profile", join(f.cwd, "missing")]) {
    const provider = createPiProvider({ ...f.options, agentDir });
    expect((await provider.health()).available).toBe(false);
    expect((await provider.start(f.input).done).outcome).toBe("unavailable");
  }
});
test("refuses profile symlinks and profile/workspace overlap", async () => {
  const f = await fixture(), link = join(f.cwd, "profile-link"); await symlink(f.agentDir, link);
  for (const options of [{ agentDir: link }, { agentDir: f.cwd, workspaceRoot: f.cwd }]) {
    expect((await createPiProvider({ ...f.options, ...options }).health()).available).toBe(false);
  }
});
test.skipIf(process.platform === "win32")("refuses a group/world-accessible profile", async () => {
  const f = await fixture(); await chmod(f.agentDir, 0o755);
  expect((await f.provider.health()).available).toBe(false);
  expect((await f.provider.start(f.input).done).outcome).toBe("unavailable");
  expect(await f.marked("launch.json")).toBe(false);
});
test.each(["select", "confirm", "input", "editor"])("unbridged %s fails explicitly rather than silently approving or waiting for deadline", async method => {
  const f = await fixture(`ui-${method}`);
  const result = await f.provider.start(f.input).done;
  expect(result.outcome).toBe("failed");
  expect(result.error).toContain("interaction");
  expect((await f.commands()).some(c => c.type === "extension_ui_response")).toBe(false);
});
