import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderEvents, ProviderRunInput } from "@chrona/contracts/steward";
import { createPiProvider } from "./pi-provider";
import { PiRawRecords } from "./pi-native";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture(mode = "normal", nativeTimeoutMs = 1500) {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-native-test-"));
  const agentDir = await mkdtemp(join(tmpdir(), "chrona-native-profile-"));
  directories.push(cwd, agentDir);
  const command = join(cwd, "fake-pi"), extension = join(cwd, "bridge.ts");
  await writeFile(extension, "");
  await writeFile(command, `#!${process.execPath}
import {appendFileSync,writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('1.5.0');process.exit(0)}
const mode=${JSON.stringify(mode)};
writeFileSync('launch.json',JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));
let streaming=false,cycle=0,queue=0,session='native-session',timer,emitted=0;
const emit=x=>{emitted++;process.stdout.write(JSON.stringify(x)+'\\n')};
const reply=(c,data={})=>emit({id:c.id,type:'response',command:c.type,success:true,data});
function run(){streaming=true;cycle++;emit({type:'agent_start'});clearTimeout(timer);timer=setTimeout(()=>{streaming=false;emit({type:'agent_end'});if(queue){queue--;run()}else emit({type:'agent_settled'})},mode==='short'?40:350)}
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))!==-1){
 const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);appendFileSync('commands.jsonl',JSON.stringify(c)+'\\n');
 if(c.type==='get_state'){reply(c,{sessionId:session,model:{provider:'test',id:'model'},isStreaming:streaming,isCompacting:false,pendingMessageCount:queue});continue}
 if(c.type==='get_commands'){reply(c,{commands:[]});continue}
 if(c.type==='get_session_stats'){reply(c);continue}
 if(c.type==='prompt'&&c.message==='reject-native'){emit({id:c.id,type:'response',command:c.type,success:false,error:'Rejected fixture input'});continue}
 if(c.type==='prompt'||c.type==='steer'||c.type==='follow_up'){reply(c);if(streaming){queue++}else run();continue}
 if(c.type==='clear_queue'){queue=0;reply(c);continue}
 if(c.type==='abort'){clearTimeout(timer);reply(c,{stopped:true});emit({type:'agent_settled',aborted:true});continue}
 if(c.type==='never_replies')continue;
 if(c.type==='change_session'){session='foreign-session';reply(c);continue}
 if(c.type==='bad_correlation'){emit({id:c.id,type:'response',command:'wrong-command',success:true});continue}
 if(c.type==='backend_failure'){emit({id:c.id,type:'response',command:c.type,success:false,error:'refused '+process.env.CHRONA_AGENT_TOKEN,details:{code:'fake_error'}});continue}
 if(c.type==='large_response'){reply(c,{text:'z'.repeat(280000)});continue}
 if(c.type==='raw_burst'){for(let i=0;i<600;i++)emit({type:'message_update',index:i,assistantMessageEvent:{type:'text_delta',delta:'x'.repeat(2000)}});reply(c);continue}
 const data={echo:c.value,pid:process.pid,token:process.env.CHRONA_AGENT_TOKEN,nested:{authorization:'Bearer fake-secret',password:'arbitrary-password',text:'safe '+process.env.CHRONA_AGENT_TOKEN},items:Array.from({length:200},(_,i)=>i),text:'x'.repeat(20000)};
 emit({type:'native_notice',requestId:c.id,value:c.value,nested:data.nested});
 setTimeout(()=>reply(c,data),c.value==='first'?80:5);
}});
process.stdin.on('end',()=>{clearTimeout(timer);writeFileSync('emitted.json',JSON.stringify(emitted));writeFileSync('closed','true');process.exit(0)});
`, { mode: 0o755 });
  const options = { command, agentDir, nativeTimeoutMs, expectedVersion: "1.5.0", chronaExtension: extension, agentUrl: "http://127.0.0.1:1234/api/steward-agent" };
  const input: ProviderRunInput = { runId: "native-run", token: "native-private-run-token", lane: "foreground", cwd, sessionDir: join(cwd, "sessions"), sessionId: null, systemPrompt: "Fixture instructions", resources: "minimal", prompt: "Start", deadline: new Date(Date.now() + 4000) };
  const commands = async (): Promise<Record<string, unknown>[]> => (await readFile(join(cwd, "commands.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  return { cwd, input, options, commands, provider: createPiProvider(options) };
}
const events = (raw: NonNullable<ProviderEvents["raw"]>): ProviderEvents => ({ raw, async progress() {}, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } });
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check().catch(() => false)) return; await Bun.sleep(10); }
  throw new Error("Fake Pi did not reach protocol boundary");
}

test("native uses the existing process, correlates out-of-order replies, and retains complete masked records", async () => {
  const f = await fixture(), records: Record<string, unknown>[] = [];
  let concurrent = 0, maxConcurrent = 0;
  const handle = f.provider.start({ ...f.input, events: events(async record => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await Bun.sleep(1); records.push(record); concurrent--; }) });
  const [first, second] = await Promise.all([
    handle.native!({ type: "future_backend_feature", id: "1", value: "first" }),
    handle.native!({ type: "future_backend_feature", id: "1", value: "second" }),
  ]);
  expect(first.id).toBe("1"); expect(second.id).toBe("1");
  expect(first.command).toBe("future_backend_feature"); expect(first.success).toBe(true);
  const data = first.data as Record<string, unknown>;
  expect(data.echo).toBe("first"); expect((second.data as Record<string, unknown>).echo).toBe("second");
  expect(data.pid).toBe(JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8")).pid);
  expect(data.items).toHaveLength(200); expect(data.text).toHaveLength(20000);
  expect(data.token).toBe("[redacted]");
  expect(data.nested).toEqual({ authorization: "[redacted]", password: "[redacted]", text: "safe [redacted]" });
  expect((await handle.done).outcome).toBe("finished");
  expect(maxConcurrent).toBe(1);
  const nativeCommands = (await f.commands()).filter(c => c.type === "future_backend_feature");
  expect(new Set(nativeCommands.map(c => c.id)).size).toBe(2);
  expect(nativeCommands.every(c => c.id !== "1")).toBe(true);
  const responses = records.filter(r => r.type === "response" && r.command === "future_backend_feature");
  expect(responses.map(r => (r.data as Record<string, unknown>).echo)).toEqual(["second", "first"]);
  expect(responses.map(r => r.id)).toEqual([nativeCommands[1]!.id, nativeCommands[0]!.id]);
  expect(JSON.stringify(records)).not.toContain(f.input.token);
  expect(JSON.stringify(records)).not.toContain("arbitrary-password");
  await expect(handle.native!({ type: "get_state" })).rejects.toMatchObject({ code: "unavailable" });
});

test("native failure preserves the backend envelope and absent caller id", async () => {
  const f = await fixture(), handle = f.provider.start(f.input);
  const response = await handle.native!({ type: "backend_failure" });
  expect(response).toEqual({ type: "response", command: "backend_failure", success: false, error: "refused [redacted]", details: { code: "fake_error" } });
  expect((await handle.done).outcome).toBe("finished");
});

test("native prompt shares steering and completion state; abort clears the queue and waits for closure", async () => {
  const f = await fixture(), handle = f.provider.start(f.input);
  await until(async () => (await f.commands()).some(c => c.type === "prompt"));
  const response = await handle.native!({ type: "prompt", message: "Second instruction", id: "caller-prompt" });
  expect(response.success).toBe(true);
  expect((await f.commands()).find(c => c.message === "Second instruction")?.streamingBehavior).toBe("steer");
  const stopped = await handle.native!({ type: "abort", id: "stop" });
  expect(stopped).toMatchObject({ id: "stop", command: "abort", success: true, data: { stopped: true } });
  const controls = (await f.commands()).filter(c => ["clear_queue", "abort"].includes(String(c.type)));
  expect(controls.map(c => c.type)).toEqual(["clear_queue", "abort"]);
  expect(await readFile(join(f.cwd, "closed"), "utf8")).toBe("true");
  expect((await handle.done).outcome).toBe("failed");
});

test.each(["never_replies", "bad_correlation", "change_session"])("%s is an unknown outcome with no replay", async type => {
  const f = await fixture("normal", 70), handle = f.provider.start(f.input);
  await expect(handle.native!({ type })).rejects.toMatchObject({ code: "unknown" });
  expect((await handle.done).outcome).toBe("failed");
  expect((await f.commands()).filter(c => c.type === type)).toHaveLength(1);
  expect((await f.commands()).filter(c => c.type === "prompt")).toHaveLength(1);
});

test("known session/bridge changes, pinned-model changes, invalid JSON and budget-bypassing bash are rejected before send", async () => {
  const f = await fixture(), handle = f.provider.start({ ...f.input, model: "test/model", executionBudget: { maxToolCalls: 2 } });
  for (const type of ["new_session", "switch_session", "set_host_tools", "set_active_tools", "set_model", "bash"]) await expect(handle.native!({ type })).rejects.toMatchObject({ code: "unsupported" });
  for (const request of [{ type: "get_state", id: 12 }, { type: "get_state", nested: { x: Infinity } }, { type: "prompt" }]) await expect(handle.native!(request)).rejects.toMatchObject({ code: "invalid" });
  await handle.abort();
  expect((await f.commands()).some(c => ["set_host_tools", "set_model", "bash"].includes(String(c.type)))).toBe(false);
});

test("large native responses fail explicitly instead of slicing JSON", async () => {
  const f = await fixture(), handle = f.provider.start(f.input);
  await expect(handle.native!({ type: "large_response" })).rejects.toMatchObject({ code: "too_large" });
  expect((await handle.done).outcome).toBe("finished");
});

test("raw backpressure emits an ordered gap and recovers without stopping work", async () => {
  const records: Record<string, unknown>[] = [];
  let failures = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const raw = new PiRawRecords(async event => { if (!records.length) await held; records.push(event); }, ["fixture-secret"], () => failures++);
  raw.receive({ type: "first", text: "fixture-secret" });
  const dropped = Array.from({ length: 4 }, (_, i) => ({ type: "queued", index: 256 + i }));
  for (let i = 0; i < 260; i++) raw.receive({ type: "queued", index: i });
  release();
  await raw.close();
  expect(failures).toBe(0);
  expect(records[0]).toEqual({ type: "first", text: "[redacted]" });
  expect(records.slice(1, -1).map(event => event.index)).toEqual(Array.from({ length: 256 }, (_, i) => i));
  expect(records.at(-1)).toEqual({ type: "chrona_raw_gap", reason: "backpressure", records: 4, originalBytes: dropped.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0) });
  raw.receive({ type: "recovered", nested: { items: [1, "fixture-secret", 3] } });
  await raw.close();
  expect(records.at(-1)).toEqual({ type: "recovered", nested: { items: [1, "[redacted]", 3] } });
});

test("raw byte bounds retain a large complete record and explicitly account for overflow", async () => {
  const records: Record<string, unknown>[] = [];
  let failures = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const raw = new PiRawRecords(async event => { await held; records.push(event); }, [], () => failures++);
  const large = { type: "tool_execution_end", result: { content: [{ type: "text", text: "x".repeat(600000) }] } };
  const oversize = { type: "oversize", text: "x".repeat(1024 * 1024) };
  raw.receive(large); raw.receive(large); raw.receive(oversize);
  release();
  await raw.close();
  expect(failures).toBe(0);
  expect(records).toEqual([large, { type: "chrona_raw_gap", reason: "backpressure", records: 2, originalBytes: Buffer.byteLength(JSON.stringify(large)) + Buffer.byteLength(JSON.stringify(oversize)) }]);
  raw.receive(oversize);
  await raw.close();
  expect(records.at(-1)).toEqual({ type: "chrona_raw_gap", reason: "too_large", records: 1, originalBytes: Buffer.byteLength(JSON.stringify(oversize)) });
});

test("loss while a gap acknowledgement fails stays fully accounted for", async () => {
  const records: Record<string, unknown>[] = [];
  let release!: () => void, rejectGap!: () => void, started!: () => void, failures = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const gapStarted = new Promise<void>(resolve => { started = resolve; });
  let firstGap = true;
  const raw = new PiRawRecords(async event => {
    if (event.type === "chrona_raw_gap" && firstGap) {
      firstGap = false;
      await new Promise<void>((_resolve, reject) => { rejectGap = () => reject(new Error("Fixture rejection")); started(); });
    } else { await held; records.push(event); }
  }, [], () => failures++);
  for (let i = 0; i < 261; i++) raw.receive({ type: "queued", index: i });
  release();
  await gapStarted;
  raw.receive({ type: "after-gap" });
  raw.receive({ type: "oversize", text: "x".repeat(1024 * 1024) });
  rejectGap();
  await expect(raw.close()).rejects.toThrow("sink_error");
  expect(failures).toBe(1);
  expect(records.filter(event => event.type === "queued")).toHaveLength(257);
  expect(records.at(-1)).toMatchObject({ type: "chrona_raw_gap", records: 6 });
});

test("large RPC responses remain raw while the native response limit stays explicit", async () => {
  const f = await fixture(), records: Record<string, unknown>[] = [];
  const handle = f.provider.start({ ...f.input, events: events(async event => { records.push(event); }) });
  await expect(handle.native!({ type: "large_response" })).rejects.toMatchObject({ code: "too_large" });
  expect((await handle.done).outcome).toBe("finished");
  expect(records.find(event => event.command === "large_response")?.data).toEqual({ text: "z".repeat(280000) });
});

test("streaming RPC bursts survive raw retention backpressure and close the process", async () => {
  const f = await fixture(), records: Record<string, unknown>[] = [];
  const handle = f.provider.start({ ...f.input, events: events(async event => { await Bun.sleep(2); records.push(event); }) });
  expect((await handle.native!({ type: "raw_burst" })).success).toBe(true);
  expect((await handle.done).outcome).toBe("finished");
  const updates = records.filter(event => event.type === "message_update");
  const lost = records.filter(event => event.type === "chrona_raw_gap").reduce((sum, event) => sum + Number(event.records), 0);
  expect(updates.length).toBeGreaterThan(0);
  const emitted = JSON.parse(await readFile(join(f.cwd, "emitted.json"), "utf8"));
  expect(records.filter(event => event.type !== "chrona_raw_gap").length + lost).toBe(emitted);
  expect(records.some(event => event.type === "chrona_raw_gap" && event.reason === "backpressure")).toBe(true);
  expect(await readFile(join(f.cwd, "closed"), "utf8")).toBe("true");
});

test("a raw acknowledgement slower than one second does not fail legitimate work", async () => {
  const f = await fixture("short");
  let calls = 0;
  const handle = f.provider.start({ ...f.input, events: events(async () => { if (++calls === 1) await Bun.sleep(1100); }) });
  expect((await handle.done).outcome).toBe("finished");
  expect(calls).toBeGreaterThan(1);
  expect(await readFile(join(f.cwd, "closed"), "utf8")).toBe("true");
});

test("raw sink failure fails the run after actual process closure", async () => {
  const f = await fixture(), records: Record<string, unknown>[] = [];
  const handle = f.provider.start({ ...f.input, events: events(async event => { records.push(event); if (event.type === "agent_start") throw new Error("Fake storage unavailable " + f.input.token); }) });
  const result = await handle.done;
  expect(result.outcome).toBe("failed"); expect(result.error).toContain("raw event stream is incomplete");
  expect(result.error).toContain("sink_error");
  expect(result.error).not.toContain(f.input.token);
  expect(result.error).not.toContain("Fake storage unavailable");
  expect(records.at(-1)?.type).toBe("chrona_raw_gap");
  expect((await f.commands()).filter(command => command.type === "prompt")).toHaveLength(1);
  expect(await readFile(join(f.cwd, "closed"), "utf8")).toBe("true");
});


test("a rejected native prompt after settlement does not strand completion", async () => {
  const f = await fixture("short"), handle = f.provider.start(f.input);
  // The slow reply keeps the same handle active beyond the model's settlement.
  await handle.native!({ type: "future_backend_feature", value: "first" });
  const response = await handle.native!({ type: "prompt", message: "reject-native" });
  expect(response.success).toBe(false);
  expect((await handle.done).outcome).toBe("finished");
});

test("raw sink timeout fails closure without concurrent callbacks or replay", async () => {
  let calls = 0, failures = 0;
  const raw = new PiRawRecords(async () => { calls++; await new Promise<void>(() => {}); }, [], () => failures++, 20);
  raw.receive({ type: "first" }); raw.receive({ type: "queued" });
  await expect(raw.close()).rejects.toThrow("sink_timeout");
  raw.receive({ type: "after-timeout" });
  await expect(raw.close()).rejects.toThrow("3 records");
  expect(calls).toBe(1); expect(failures).toBe(1);
});

test("deep raw records emit a complete explicit gap instead of crashing or clipping", async () => {
  const records: Record<string, unknown>[] = [];
  const raw = new PiRawRecords(async event => { records.push(event); }, [], () => {});
  let deep: Record<string, unknown> = {};
  for (let i = 0; i < 150; i++) deep = { nested: deep };
  raw.receive(deep);
  // Even a value deeper than JSON.stringify's stack must produce a gap.
  for (let i = 0; i < 10000; i++) deep = { nested: deep };
  raw.receive(deep);
  await raw.close();
  expect(records.every(event => event.type === "chrona_raw_gap" && event.reason === "too_large")).toBe(true);
  expect(records.reduce((sum, event) => sum + Number(event.records), 0)).toBe(2);
  raw.receive({ type: "recovered" });
  await raw.close();
  expect(records.at(-1)).toEqual({ type: "recovered" });
});

test("host and per-run thinking options select Pi arguments without touching profile settings", async () => {
  const f = await fixture("short");
  const provider = createPiProvider({ ...f.options, thinking: "medium" });
  const first = provider.start(f.input);
  expect((await first.done).outcome).toBe("finished");
  const hostArgs = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8")).args;
  expect(hostArgs[hostArgs.indexOf("--thinking") + 1]).toBe("medium");
  const second = provider.start({ ...f.input, providerOptions: { thinking: "high" } });
  expect((await second.done).outcome).toBe("finished");
  const runArgs = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8")).args;
  expect(runArgs[runArgs.indexOf("--thinking") + 1]).toBe("high");
});
