import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiProvider } from "./pi-provider";
import type { ProviderRunInput } from "@chrona/contracts/steward";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

// Synthetic Pi 1.5 RPC only. Recovery uses finite retries explicitly chosen in the
// user's settings. Timers are shortened; the configured delays remain observable.
async function fixture(mode = "recover", settingsSource?: string | null) {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-pi-retry-"));
  const agentDir = await mkdtemp(join(tmpdir(), "chrona-pi-retry-profile-"));
  directories.push(cwd, agentDir);
  const command = join(cwd, "fake-pi"), extension = join(cwd, "bridge.ts");
  const original = settingsSource === undefined ? JSON.stringify({ defaultModel: "retained", compaction: { enabled: true, reserveTokens: 1234 },
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 17, maxAgentDelayMs: 43,
      provider: { maxRetries: 9, timeoutMs: 12345 } } }) : settingsSource;
  if (original !== null) await writeFile(join(agentDir, "settings.json"), original);
  await writeFile(extension, "");
  await writeFile(command, `#!${process.execPath}
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
if(process.argv.includes('--version')){console.log('1.5.0');process.exit(0)}
const mode=${JSON.stringify(mode)}, profile=process.env.PI_CODING_AGENT_DIR;
const settingsPath=join(profile,'settings.json');
const raw=existsSync(settingsPath)?readFileSync(settingsPath,'utf8').replace(/^\\uFEFF/,'').trim():'';
const settings=raw?JSON.parse(raw):{};
const retry={...settings.retry};
writeFileSync('launch.json',JSON.stringify({profile,settings,args:process.argv.slice(2)}));
let streaming=false, retrying=false, attempt=0, aborted=false, timer;
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const reply=(c,data={})=>emit({type:'response',id:c.id,command:c.type,success:true,data});
const mark=name=>writeFileSync(name,'true');
const settle=()=>{mark('settled');emit({type:'agent_settled',aborted})};
const failure=errorMessage=>({role:'assistant',stopReason:'error',errorMessage});
const tool=id=>{appendFileSync('effects.jsonl',JSON.stringify({id})+'\\n');emit({type:'tool_execution_start',toolCallId:id,toolName:'bash'});emit({type:'tool_execution_end',toolCallId:id,toolName:'bash',result:{content:[]}})};
function run(){
 if(aborted)return;
 streaming=true;emit({type:'agent_start'});
 appendFileSync('attempts.jsonl',JSON.stringify({attempt})+'\\n');
 if(attempt===0)tool('effect-before-error');
 if(mode==='retry-stream'&&attempt>0){mark('retry-stream');return}
 if(mode==='tool-limit'&&attempt>0){tool('effect-after-retry');return}
 if(mode.startsWith('terminal-')&&attempt>0){
  streaming=false;emit({type:'agent_end',messages:[]});retrying=false;
  emit({type:'auto_retry_end',success:false,attempt,finalError:mode==='terminal-empty'?'':mode==='terminal-missing'?undefined:'terminal '+process.env.CHRONA_AGENT_TOKEN});
  timer=setTimeout(settle,100);return;
 }
 const recovered=mode==='success'||mode==='recover'&&attempt===retry.maxRetries;
 const message=recovered?{role:'assistant',stopReason:'stop',content:[{type:'text',text:'Recovered'}]}:
  failure(mode==='permanent'?'401 unauthorized':mode==='overflow'?'context length exceeded':'upstream_stream_read_error '+process.env.CHRONA_AGENT_TOKEN);
 emit({type:'message_end',message});streaming=false;
 const willRetry=!recovered&&!['permanent','overflow'].includes(mode)&&retry.enabled&&attempt<retry.maxRetries;
 emit({type:'agent_end',messages:[message],willRetry});
 if(willRetry){
  // No settled event in the gap between a model failure and recovery scheduling.
  timer=setTimeout(()=>{
   retrying=true;attempt++;
   const recovery={attempt,maxAttempts:retry.maxRetries,delayMs:Math.min(retry.baseDelayMs*2**(attempt-1),retry.maxAgentDelayMs)};
   appendFileSync('retries.jsonl',JSON.stringify(recovery)+'\\n');
   emit({type:'auto_retry_start',...recovery,errorMessage:message.errorMessage});
   mark('retry-wait');
   if(mode!=='retry-wait')timer=setTimeout(run,25);
  },25);
 }else{
  if(attempt>0){retrying=false;emit({type:'auto_retry_end',success:recovered,attempt,finalError:recovered?undefined:message.errorMessage})}
  timer=setTimeout(settle,100);
 }
}
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))!==-1){
 const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);appendFileSync('commands.jsonl',JSON.stringify(c)+'\\n');
 if(c.type==='get_state')reply(c,{sessionId:'retry-session',model:{provider:'openai',id:'pinned'},isStreaming:streaming,isCompacting:false,pendingMessageCount:0});
 if(c.type==='get_commands')reply(c,{commands:[]});
 if(c.type==='set_auto_retry'){retry.enabled=c.enabled;settings.retry={...settings.retry,enabled:c.enabled};reply(c)}
 if(c.type==='set_auto_compaction'){settings.compaction={...settings.compaction,enabled:c.enabled};reply(c)}
 if(c.type==='prompt'){writeFileSync('prompt-settings.json',JSON.stringify(settings));reply(c);run()}
 if(c.type==='clear_queue')reply(c,{steering:[],followUp:[]});
 if(c.type==='abort'){aborted=true;clearTimeout(timer);reply(c);if(retrying)emit({type:'auto_retry_end',success:false,attempt,finalError:'Retry cancelled'});settle()}
}});
process.stdin.on('end',()=>{clearTimeout(timer);mark('closed');process.exit(0)});
`, { mode: 0o755 });
  const options = { command, agentDir, expectedVersion: "1.5.0", chronaExtension: extension, agentUrl: "http://127.0.0.1:1234/api/steward-agent" };
  const input: ProviderRunInput = { runId: "retry-run", token: "private-retry-token", lane: "foreground", cwd,
    sessionDir: join(cwd, "sessions"), sessionId: null, resources: "minimal", systemPrompt: "Fixture instructions", prompt: "Act once", deadline: new Date(Date.now() + 4000) };
  const json = async (name: string) => JSON.parse(await readFile(join(cwd, name), "utf8"));
  const lines = async (name: string): Promise<Record<string, unknown>[]> => (await readFile(join(cwd, name), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  return { cwd, agentDir, original, options, input, json, lines, provider: createPiProvider(options) };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) { if (check()) return; await Bun.sleep(10); }
  throw new Error("Fake Pi did not reach retry boundary");
}

test.each([
  { resources: "minimal" as const },
  { resources: "minimal" as const, model: "openai/pinned" },
  { resources: "configured" as const, model: "openai/pinned" },
])("finite retries recover within one prompt and retain completed effects: %j", async selection => {
  const f = await fixture();
  const result = await f.provider.start({ ...f.input, ...selection, executionBudget: { maxToolCalls: 1 } }).done;
  expect(result).toEqual({ outcome: "finished", sessionId: "retry-session", error: null });
  const launch = await f.json("launch.json"), settings = await f.json("prompt-settings.json");
  expect(launch.profile).toBe(f.agentDir);
  expect(await readdir(f.agentDir)).toEqual(["settings.json"]);
  expect(launch.settings).toEqual(JSON.parse(f.original!));
  expect(settings).toEqual(launch.settings);
  expect(launch.args).not.toContain("--no-approve");
  if (selection.model) expect(launch.args[launch.args.indexOf("--model") + 1]).toBe(selection.model);
  expect(await readFile(join(f.agentDir, "settings.json"), "utf8")).toBe(f.original!);
  expect(await f.lines("attempts.jsonl")).toEqual([{ attempt: 0 }, { attempt: 1 }, { attempt: 2 }, { attempt: 3 }]);
  expect(await f.lines("retries.jsonl")).toEqual([
    { attempt: 1, maxAttempts: 3, delayMs: 17 },
    { attempt: 2, maxAttempts: 3, delayMs: 34 },
    { attempt: 3, maxAttempts: 3, delayMs: 43 },
  ]);
  expect(await f.lines("effects.jsonl")).toEqual([{ id: "effect-before-error" }]);
  const commands = await f.lines("commands.jsonl");
  expect(commands.filter(c => c.type === "prompt")).toHaveLength(1);
  expect(commands.filter(c => ["set_auto_retry", "set_auto_compaction"].includes(String(c.type)))).toEqual([]);
  expect(existsSync(join(f.cwd, "settled"))).toBe(true);
  expect(existsSync(join(f.cwd, "closed"))).toBe(true);
});

test.each(["missing", "empty", "bom", "bom-only"])("%s user settings are left unchanged", async format => {
  const original = format === "missing" ? null : format === "bom" ? '\uFEFF{ "retry": { "enabled": false }, "theme": "retained" }\n' : format === "bom-only" ? "\uFEFF" : "";
  const f = await fixture("success", original);
  const settingsPath = join(f.agentDir, "settings.json");
  const result = await f.provider.start({ ...f.input, model: "openai/pinned" }).done;
  expect(result.outcome).toBe("finished");
  const launch = await f.json("launch.json");
  expect(launch.profile).toBe(f.agentDir);
  expect(launch.settings).toEqual(format === "bom" ? { retry: { enabled: false }, theme: "retained" } : {});
  expect(await f.json("prompt-settings.json")).toEqual(launch.settings);
  expect((await f.lines("commands.jsonl")).filter(c => ["set_auto_retry", "set_auto_compaction"].includes(String(c.type)))).toEqual([]);
  expect(await readdir(f.agentDir)).toEqual(original === null ? [] : ["settings.json"]);
  if (original === null) expect(existsSync(settingsPath)).toBe(false);
  else expect(await readFile(settingsPath, "utf8")).toBe(original);
});

test.each(["minimal", "configured"] as const)("disabled user retries stay disabled with %s resources", async resources => {
  const original = '{ "retry": { "enabled": false, "maxRetries": 73, "baseDelayMs": 999999, "provider": { "maxRetries": 11 } }, "compaction": { "enabled": true } }\n';
  const f = await fixture("exhaust", original);
  const result = await f.provider.start({ ...f.input, resources, model: "openai/pinned" }).done;
  expect(result.outcome).toBe("failed");
  expect(result.error).toContain("[redacted]");
  expect(result.error).not.toContain(f.input.token);
  expect(await f.lines("attempts.jsonl")).toEqual([{ attempt: 0 }]);
  expect(await f.lines("effects.jsonl")).toEqual([{ id: "effect-before-error" }]);
  expect(existsSync(join(f.cwd, "retries.jsonl"))).toBe(false);
  const commands = await f.lines("commands.jsonl");
  expect(commands.filter(c => c.type === "prompt")).toHaveLength(1);
  expect(commands.filter(c => ["set_auto_retry", "set_auto_compaction"].includes(String(c.type)))).toEqual([]);
  expect(await f.json("prompt-settings.json")).toEqual(JSON.parse(original));
  expect(await readFile(join(f.agentDir, "settings.json"), "utf8")).toBe(original);
  expect(existsSync(join(f.cwd, "settled"))).toBe(true);
  expect(existsSync(join(f.cwd, "closed"))).toBe(true);
});

test.each(["exhaust", "permanent", "overflow", "terminal-event", "terminal-empty", "terminal-missing"])("%s fails at the settled boundary without replay", async mode => {
  const f = await fixture(mode), result = await f.provider.start(f.input).done;
  expect(result.outcome).toBe("failed");
  expect(result.error).not.toContain(f.input.token);
  expect(result.error).toContain(mode === "permanent" ? "401 unauthorized" : mode === "overflow" ? "context length exceeded" : ["terminal-empty", "terminal-missing"].includes(mode) ? "Pi model retry failed" : "[redacted]");
  expect(await f.lines("attempts.jsonl")).toHaveLength(mode === "exhaust" ? 4 : mode.startsWith("terminal-") ? 2 : 1);
  expect((await f.lines("commands.jsonl")).filter(c => c.type === "prompt")).toHaveLength(1);
  expect(await f.lines("effects.jsonl")).toEqual([{ id: "effect-before-error" }]);
  expect(existsSync(join(f.cwd, "settled"))).toBe(true);
  expect(existsSync(join(f.cwd, "closed"))).toBe(true);
});

test.each(["retry-wait", "retry-stream"])("cancel during %s clears queue, aborts and waits for closure", async mode => {
  const f = await fixture(mode), handle = f.provider.start(f.input);
  await until(() => existsSync(join(f.cwd, mode)));
  await handle.abort();
  expect(await handle.done).toMatchObject({ outcome: "failed", error: "Pi run aborted" });
  await expect(handle.inject("late")).rejects.toThrow("not active");
  const commands = await f.lines("commands.jsonl");
  expect(commands.filter(c => c.type === "prompt")).toHaveLength(1);
  expect(commands.filter(c => ["clear_queue", "abort"].includes(String(c.type))).map(c => c.type)).toEqual(["clear_queue", "abort"]);
  expect(await f.lines("attempts.jsonl")).toHaveLength(mode === "retry-wait" ? 1 : 2);
  expect(existsSync(join(f.cwd, "closed"))).toBe(true);
});

test.each(["retry-wait", "retry-stream"])("the original deadline interrupts %s", async mode => {
  const f = await fixture(mode);
  const handle = f.provider.start({ ...f.input, deadline: new Date(Date.now() + 600) });
  await until(() => existsSync(join(f.cwd, "retry-wait")));
  expect(await handle.done).toMatchObject({ outcome: "timed_out", error: "Pi deadline exceeded" });
  expect((await f.lines("commands.jsonl")).filter(c => ["clear_queue", "abort"].includes(String(c.type))).map(c => c.type)).toEqual(["clear_queue", "abort"]);
  expect(await f.lines("attempts.jsonl")).toHaveLength(mode === "retry-wait" ? 1 : 2);
  expect(existsSync(join(f.cwd, "closed"))).toBe(true);
});

test("retrying does not bypass the idle limit", async () => {
  const f = await fixture("retry-wait");
  const handle = createPiProvider({ ...f.options, idleTimeoutMs: 150 }).start(f.input);
  await until(() => existsSync(join(f.cwd, "retry-wait")));
  expect(await handle.done).toMatchObject({ outcome: "timed_out", error: expect.stringContaining("no output") });
  expect(await f.lines("attempts.jsonl")).toHaveLength(1);
  expect(existsSync(join(f.cwd, "closed"))).toBe(true);
});

test("tool calls before recovery still count against the Run limit", async () => {
  const f = await fixture("tool-limit");
  const result = await f.provider.start({ ...f.input, executionBudget: { maxToolCalls: 1 } }).done;
  expect(result).toMatchObject({ outcome: "failed", error: "Execution tool budget exceeded" });
  expect(await f.lines("attempts.jsonl")).toHaveLength(2);
  expect(await f.lines("effects.jsonl")).toEqual([{ id: "effect-before-error" }, { id: "effect-after-retry" }]);
  expect((await f.lines("commands.jsonl")).filter(c => c.type === "prompt")).toHaveLength(1);
  expect(existsSync(join(f.cwd, "closed"))).toBe(true);
});
