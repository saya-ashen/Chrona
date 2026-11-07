import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createPiProvider } from "./pi-provider";
import { piArguments, piLaunchConfig, prepareContent } from "./pi-launch";
import { EXECUTION_EVENT_LIMITS, executionEventSchema, type ExecutionEvent, type ProviderRunInput } from "@chrona/contracts/steward";

// Only fake subprocesses, never the installed model runner. Temp artifacts deliberately
// remain in OS temp (worker task forbids deletions).
async function fixture(mode = "normal") {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-pi-rpc-"));
  const command = join(cwd, "pi");
  await writeFile(command, `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) {console.log('0.85.0');process.exit(0);}
writeFileSync('launch.json', JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),profile:process.env.PI_CODING_AGENT_DIR,executionToolBudget:process.env.CHRONA_EXECUTION_MAX_TOOL_CALLS,hasChronaDatabaseSecret:'CHRONA_DATABASE_SECRET' in process.env,tokenMatches:process.env.CHRONA_AGENT_TOKEN==='private-run-token'}));
const mode=${JSON.stringify(mode)};
let streaming=false, queue=0, cycle=0, retried=false;
const emit = x => process.stdout.write(JSON.stringify(x)+'\\r\\n');
const reply=(c,data={})=>emit({id:c.id,type:'response',command:c.type,success:true,data});
function run() {
 streaming=true; cycle++; emit({type:'agent_start'});
 if(mode==='details') {
  emit({type:'message_start',message:{role:'assistant'}});
  for(let i=0;i<300;i++) emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'safe '+process.env.CHRONA_AGENT_TOKEN}});
  emit({type:'tool_execution_start',toolCallId:'tool1',toolName:'bash',args:{command:'TOP SECRET RAW ARGS',headers:{authorization:'Bearer private'}}});
  emit({type:'tool_execution_end',toolCallId:'tool1',toolName:'bash',result:{content:[{type:'text',text:'TOP SECRET RAW RESULT'}]}});
  emit({type:'message_end',message:{role:'assistant',content:[{type:'thinking',thinking:'TOP SECRET THINKING'},{type:'text',text:'Final safe '+process.env.CHRONA_AGENT_TOKEN}]}});
 }
 setTimeout(()=>{
  if(mode==='error') emit({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'failed '+process.env.CHRONA_AGENT_TOKEN}});
  streaming=false; writeFileSync('completed-cycles.txt',String(cycle));emit({type:'agent_end'});
  if(queue) setTimeout(()=>{queue--; run();},45);
  else emit({type:'agent_settled'});
 },100);
}
let buffer='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 buffer+=chunk;
 let n;
 while((n=buffer.indexOf('\\n'))!==-1){
  const c=JSON.parse(buffer.slice(0,n)); buffer=buffer.slice(n+1);
  appendFileSync('commands.jsonl',JSON.stringify(c)+'\\n');
  if(c.type==='get_state') {
   if(mode==='retry-state' && cycle===1 && !streaming && !retried) {
    retried=true;
    emit({type:'auto_retry_start'});
    setTimeout(()=>{
     emit({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'retry failed'}});
     emit({type:'auto_retry_end'});
     emit({type:'agent_end'});emit({type:'agent_settled'});
    },60);
   }
   reply(c,{sessionId:'retained-session',model:{provider:'openai',id:mode==='wrong-model'?'other':'gpt-6.1-sol'},isStreaming:streaming,isCompacting:false,pendingMessageCount:queue});
  }
  if(c.type==='get_commands') reply(c,{commands:[]});
  if(c.type==='set_auto_retry'||c.type==='set_auto_compaction') reply(c);
  if(c.type==='clear_queue') {queue=0;reply(c,{steering:[],followUp:[]});}
  if(c.type==='prompt') {
   reply(c);
   if(streaming&&c.streamingBehavior){queue++;continue;}
   if(mode==='crash'){process.stderr.write('crash '+process.env.CHRONA_AGENT_TOKEN);process.exit(7);}
   else if(mode==='malformed') process.stdout.write('not-json\\n');
   else if(mode==='partial') { const data=Buffer.from(JSON.stringify({type:'message_update',text:'你好\\u2028世界'})+'\\n'); process.stdout.write(data.subarray(0,43)); setTimeout(()=>{process.stdout.write(data.subarray(43));run();},10); }
   else if(mode!=='hang') run();
  }
  if(c.type==='steer'||c.type==='follow_up'){queue++;reply(c);}
  if(c.type==='abort'){reply(c); if(mode!=='hang')process.exit(0);}
 }
});
process.stdin.on('end',()=>process.exit(0));
`, { mode: 0o755 });
  await writeFile(join(cwd, "bridge.ts"), "");
  await writeFile(join(cwd, "web.ts"), "");
  const agentDir = await mkdtemp(join(tmpdir(), "chrona-pi-profile-"));
  const options = { command, agentDir, expectedVersion: "0.85.0", chronaExtension: join(cwd, "bridge.ts"), agentUrl: "http://127.0.0.1:1234/api/steward-agent" };
  const provider = createPiProvider(options);
  const input: ProviderRunInput = { runId: "run", token: "private-run-token", lane: "foreground", cwd, sessionDir: join(cwd, ".chrona/sessions"), sessionId: "previous-id", systemPrompt: "Fixture platform instructions", resources: "configured", prompt: "hello", deadline: new Date(Date.now() + 4000) };
  const commands = async () => (await readFile(join(cwd, "commands.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  return { cwd, command, agentDir, options, provider, input, commands };
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check().catch(() => false)) return; await Bun.sleep(10); }
  throw new Error("fixture did not reach expected state");
}
describe("Pi RPC provider", () => {
  test("minimal resources and supplied instructions do not depend on an execution identity", async () => {
    const f = await fixture();
    const provider = createPiProvider({ ...f.options, webExtension: join(f.cwd, "web.ts") });
    expect((await provider.start({ ...f.input, resources: "minimal", systemPrompt: "Perform a bounded document task.", executionBudget: { maxToolCalls: 2 } }).done).outcome).toBe("finished");
    const { args, executionToolBudget } = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
    expect(executionToolBudget).toBe("2");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("Perform a bounded document task.");
    const tools = args[args.indexOf("--tools") + 1].split(",");
    expect(tools).toContain("bash");
    expect(tools).not.toContain("chrona_reply");
    expect(tools).not.toContain("web_search");
    expect(args).not.toContain(join(f.cwd, "web.ts"));
    expect((await provider.start({ ...f.input, execution: { workId: "work", sessionId: "session", runId: f.input.runId, attemptId: "attempt" } }).done).outcome).toBe("finished");
    const configured = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8")).args;
    expect(configured[configured.indexOf("--tools") + 1].split(",")).toContain("chrona_reply");
    expect(configured).toContain(join(f.cwd, "web.ts"));
  });
  test("an exact build model overrides defaults and is verified before prompting; retries are disabled", async () => {
    const f = await fixture();
    await writeFile(join(f.agentDir, "settings.json"), '{"retry":{"enabled":true}}');
    const provider = createPiProvider({ ...f.options, model: "other/default" });
    expect((await provider.start({ ...f.input, model: "openai/gpt-6.1-sol", sessionId: null }).done).outcome).toBe("finished");
    const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
    const args = launch.args;
    expect(args[args.indexOf("--model") + 1]).toBe("openai/gpt-6.1-sol");
    expect(launch.profile.startsWith(join(f.agentDir, "build-"))).toBe(true);
    expect(existsSync(launch.profile)).toBe(false);
    expect(await readFile(join(f.agentDir, "settings.json"), "utf8")).toBe('{"retry":{"enabled":true}}');
    const commands = await f.commands();
    expect(commands.find(c => c.type === "set_auto_retry")).toMatchObject({ enabled: false });
    expect(commands.findIndex(c => c.type === "set_auto_retry")).toBeLessThan(commands.findIndex(c => c.type === "prompt"));
  });
  test("a model mismatch fails closed without sending any prompt or falling back", async () => {
    const f = await fixture("wrong-model");
    expect((await f.provider.start({ ...f.input, model: "openai/gpt-6.1-sol" }).done).outcome).toBe("failed");
    expect((await f.commands()).some(c => c.type === "prompt")).toBe(false);
  });
  test("default and explicit trusted-local ignore bubblewrap; required-isolation fails when it cannot isolate", async () => {
    const f = await fixture();
    const bwrap = join(f.cwd, "bwrap");
    await writeFile(bwrap, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo bubblewrap; exit 0; fi\nexit 1\n`, { mode: 0o755 });
    for (const executionMode of [undefined, "trusted-local"] as const) {
      const local = createPiProvider({ ...f.options, bwrap, executionMode });
      expect((await local.start(f.input).done).outcome).toBe("finished");
      expect(JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8")).args).not.toContain("--tmpfs");
    }
    await writeFile(join(f.cwd, "commands.jsonl"), "");
    const required = createPiProvider({ ...f.options, bwrap, executionMode: "required-isolation" });
    expect((await required.start(f.input).done).outcome).toBe("unavailable");
    expect(await readFile(join(f.cwd, "commands.jsonl"), "utf8")).not.toContain('"type":"prompt"');
    expect((await required.health()).available).toBe(false);
  });
  test("session, tools, images, cwd and filtered environment", async () => {
    const f = await fixture();
    const before = process.env.CHRONA_DATABASE_SECRET;
    process.env.CHRONA_DATABASE_SECRET = "must-not-leak";
    try {
      // Module tools must survive Pi's --tools allowlist; malformed names never reach the argument list.
      const handle = f.provider.start({ ...f.input, images: [{ mime: "image/png", base64: "YWJj" }], extraTools: ["m_ledger_add_expense", "read,bash", "m_Bad"] });
      expect(await handle.done).toEqual({ outcome: "finished", sessionId: "retained-session", error: null });
      const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
      expect(launch.cwd).toBe(f.cwd);
      expect(launch.hasChronaDatabaseSecret).toBe(false);
      expect(launch.executionToolBudget).toBeUndefined();
      expect(launch.tokenMatches).toBe(true);
      expect(launch.args[launch.args.indexOf("--session-id") + 1]).toBe("previous-id");
      const tools = launch.args[launch.args.indexOf("--tools") + 1].split(",");
      expect(tools).toContain("read"); expect(tools).toContain("chrona_reply"); expect(tools).toContain("bash"); expect(tools).not.toContain("web_search");
      expect(tools).toContain("m_ledger_add_expense"); expect(tools).not.toContain("m_Bad");
      expect(tools).not.toContain("tool_search"); expect(launch.args).not.toContain("builtin:tool-search");
      expect((await f.commands()).find(c => c.type === "prompt").images).toEqual([{ type: "image", mimeType: "image/png", data: "YWJj" }]);
      expect(await f.provider.health()).toEqual({ available: true, sandboxed: false, error: null });
    } finally { if (before === undefined) delete process.env.CHRONA_DATABASE_SECRET; else process.env.CHRONA_DATABASE_SECRET = before; }
  });
  test("deferred module tools load Pi's tool search and stay behind the m_* pattern", async () => {
    const f = await fixture();
    const handle = f.provider.start({ ...f.input, extraTools: ["m_ledger_add_expense"], searchTools: true });
    await handle.done;
    const args: string[] = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8")).args;
    expect(args[args.indexOf("builtin:tool-search") - 1]).toBe("-e");
    expect(args[args.indexOf("--tools") + 1].split(",")).toEqual(expect.arrayContaining(["m_ledger_add_expense", "tool_search", "m_*"]));
  });
  test("injection queues steering during streaming and waits across agent_end", async () => {
    const f = await fixture(), handle = f.provider.start(f.input);
    await until(async () => (await f.commands()).some(c => c.type === "prompt"));
    await Bun.sleep(20);
    await handle.inject("more", [{ mime: "image/jpeg", base64: "ZA==" }]);
    expect((await f.commands()).find(c => c.type === "prompt" && c.message === "more")).toMatchObject({ streamingBehavior: "steer", images: [{ type: "image", mimeType: "image/jpeg", data: "ZA==" }] });
    expect((await handle.done).outcome).toBe("finished");
    expect(await readFile(join(f.cwd, "completed-cycles.txt"), "utf8")).toBe("2");
    expect((await f.commands()).filter(c => c.type === "get_state").length).toBeGreaterThanOrEqual(2);
  });
  test("rechecks completion when retry starts during get_state", async () => {
    const f = await fixture("retry-state");
    const result = await f.provider.start(f.input).done;
    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("retry failed");
    expect((await f.commands()).filter(c => c.type === "get_state").length).toBeGreaterThan(2);
  });
  test("early injection waits for startup and lets Pi choose starting or steering", async () => {
    const f = await fixture(), handle = f.provider.start(f.input);
    await handle.inject("queued before streaming");
    expect((await handle.done).outcome).toBe("finished");
    expect((await f.commands()).find(c => c.message === "queued before streaming")).toMatchObject({ type: "prompt", streamingBehavior: "steer" });
    expect(await readFile(join(f.cwd, "completed-cycles.txt"), "utf8")).toBe("2");
  });
  test.each(["partial", "malformed", "error", "crash"])("handles %s output", async mode => {
    const f = await fixture(mode), result = await f.provider.start(f.input).done;
    expect(result.outcome).toBe(mode === "partial" ? "finished" : "failed");
    expect(result.error ?? "").not.toContain(f.input.token);
    if (mode === "error" || mode === "crash") expect(result.error).toContain("[redacted]");
  });
  test("deadline sends abort and returns timed_out; explicit abort waits for exit", async () => {
    const f = await fixture("hang");
    expect((await f.provider.start({ ...f.input, deadline: new Date(Date.now() + 200) }).done).outcome).toBe("timed_out");
    expect((await f.commands()).some(c => c.type === "abort")).toBe(true);
    const second = f.provider.start(f.input);
    await second.abort(); expect((await second.done).outcome).toBe("failed");
    await expect(second.inject("late")).rejects.toThrow();
  });
  test("unavailable executable and expired deadline", async () => {
    const f = await fixture();
    const provider = createPiProvider({ ...f.options, command: join(f.cwd, "missing") });
    expect((await provider.health()).available).toBe(false);
    expect((await provider.start(f.input).done).outcome).toBe("unavailable");
    expect((await provider.start({ ...f.input, deadline: new Date(0) }).done).outcome).toBe("timed_out");
    const noExtension = createPiProvider({ ...f.options, chronaExtension: join(f.cwd, "missing.ts") });
    expect((await noExtension.health()).error).toContain("extension missing");
  });
  test.each([false, true])("bwrap mounts session cwd (configured root=%s), shares network, and enables bash/web", async rootRun => {
    const f = await fixture();
    await mkdir(f.input.sessionDir, { recursive: true });
    const bwrap = join(f.cwd, "bwrap");
    await writeFile(bwrap, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nif(process.argv.includes('--version')||process.argv.includes('--unshare-all'))process.exit(0);\nconst a=process.argv.slice(2);writeFileSync('bwrap.json',JSON.stringify(a));const p=Bun.spawn(a.slice(a.indexOf('--')+1),{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exit(await p.exited);\n`, { mode: 0o755 });
    const provider = createPiProvider({ ...f.options, bwrap, executionMode: "required-isolation", workspaceRoot: rootRun ? f.cwd : undefined, webExtension: join(f.cwd, "web.ts") });
    expect((await provider.start(f.input).done).outcome).toBe("finished");
    const args = JSON.parse(await readFile(join(f.cwd, "bwrap.json"), "utf8"));
    expect(args).toContain("--die-with-parent"); expect(args).toContain("--ro-bind"); expect(args).toContain("--tmpfs"); expect(args).not.toContain("--unshare-net");
    expect(args[args.indexOf("--tools") + 1].split(",")).toContain("bash");
    expect(args[args.indexOf("--tools") + 1].split(",")).toContain("web_search");
    expect((await provider.health()).sandboxed).toBe(true);
    const mounts = args.flatMap((arg: string, i: number) => arg === "--bind" || arg === "--ro-bind" ? [{ mode: arg, source: args[i + 1], target: args[i + 2] }] : []);
    expect(mounts).toContainEqual({ mode: "--bind", source: f.cwd, target: f.cwd });
    expect(mounts).toContainEqual({ mode: "--bind", source: f.agentDir, target: f.agentDir });
    expect(mounts.some((m: { source: string }) => m.source === join(process.env.HOME!, ".pi"))).toBe(false);
    expect(mounts).toContainEqual({ mode: "--bind", source: f.input.sessionDir, target: f.input.sessionDir });
  });
});

const realBwrap = Bun.which("bwrap");
test.skipIf(!realBwrap)("real bwrap: content areas appear under content/, writable only when focused, root stays read-only", async () => {
  const f = await fixture();
  await mkdir(f.input.sessionDir, { recursive: true });
  const files = join(f.cwd, "content-files"), notes = join(f.cwd, "content-notes");
  await mkdir(files); await mkdir(notes); await writeFile(join(files, "a.md"), "hi\n");
  const config = piLaunchConfig({ ...f.options, bwrap: realBwrap!, executionMode: "required-isolation" });
  const input = { ...f.input, content: [{ name: "files", dir: files, writable: false }, { name: "notes", dir: notes, writable: true }] };
  prepareContent(input, false);
  const args = piArguments(config, input, "p");
  const script = "cat content/files/a.md; echo x > content/notes/b && echo notes-rw; (echo y > content/files/c) 2>/dev/null || echo files-ro; touch /chrona-root-probe 2>/dev/null || echo root-ro";
  const proc = Bun.spawn([realBwrap!, ...args.slice(0, args.indexOf("--") + 1), "/bin/sh", "-c", script], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text()];
  expect({ code: await proc.exited, err }).toEqual({ code: 0, err: "" });
  expect(out.split("\n").filter(Boolean)).toEqual(["hi", "notes-rw", "files-ro", "root-ro"]);
});
test("execution details are bounded/redacted, recover final after saturation and omit personal steward context", async () => {
  const f = await fixture("details"), records: ExecutionEvent[] = [];
  const ref = { workId: "work", sessionId: "coding-session", runId: "run", attemptId: "attempt" };
  let concurrent = 0, maxConcurrent = 0;
  const result = await f.provider.start({ ...f.input, systemPrompt: "Fixture execution instructions", resources: "minimal", execution: ref, executionBudget: { maxToolCalls: 5 }, sessionId: null, detail: { async append(event) {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await Bun.sleep(2); records.push(event); concurrent--;
  } } }).done;
  expect(result.outcome).toBe("failed");
  expect(result.error).toContain("detail is incomplete");
  expect(maxConcurrent).toBe(1);
  expect(records.length).toBeLessThanOrEqual(EXECUTION_EVENT_LIMITS.bufferEvents + 4);
  expect(records.every(event => executionEventSchema.safeParse(event).success)).toBe(true);
  expect(records.some(event => event.payload.type === "gap")).toBe(true);
  expect(records.findLast(event => event.payload.type === "message")?.payload).toMatchObject({ text: "Final safe [redacted]", complete: true });
  expect(records.at(-1)?.payload).toMatchObject({ type: "state", stopConfirmed: true });
  expect(JSON.stringify(records)).not.toContain("TOP SECRET");
  expect(JSON.stringify(records)).not.toContain(f.input.token);
  const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
  const prompt = launch.args[launch.args.indexOf("--append-system-prompt") + 1];
  expect(prompt).toBe("Fixture execution instructions");
  expect(launch.args[launch.args.indexOf("--tools") + 1]).not.toContain("chrona_remember");
  expect(launch.executionToolBudget).toBe("5");
  expect(existsSync(join(f.cwd, "content"))).toBe(false);
});
test("detail append failure is surfaced after process exit and final delivery still attempted", async () => {
  const f = await fixture("details"); let finalAttempted = false;
  const result = await f.provider.start({ ...f.input, execution: { workId: "work", sessionId: "session", runId: "run", attemptId: "attempt" }, detail: { async append(event) { if (event.payload.type === "message" && event.payload.complete) finalAttempted = true; throw new Error("Disk unavailable"); } } }).done;
  expect(result.outcome).toBe("failed"); expect(finalAttempted).toBe(true);
});
test("without bwrap content areas are symlinks under content/ and stale links are replaced", async () => {
  const f = await fixture();
  const files = join(f.cwd, "content-files"), old = join(f.cwd, "content-old");
  await mkdir(files); await mkdir(old); await writeFile(join(files, "a.md"), "hi\n");
  prepareContent({ ...f.input, content: [{ name: "old", dir: old, writable: true }] }, true);
  prepareContent({ ...f.input, content: [{ name: "files", dir: files, writable: false }] }, true);
  expect(await readFile(join(f.input.cwd, "content", "files", "a.md"), "utf8")).toBe("hi\n");
  expect(existsSync(join(f.input.cwd, "content", "old"))).toBe(false);
});
