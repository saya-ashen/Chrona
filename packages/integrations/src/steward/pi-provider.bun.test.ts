import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiProvider } from "./pi-provider";
import type { ProviderRunInput } from "@chrona/contracts/steward";

// Only fake subprocesses, never the installed model runner. Temp artifacts deliberately
// remain in OS temp (worker task forbids deletions).
async function fixture(mode = "normal") {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-pi-rpc-"));
  const command = join(cwd, "pi");
  await writeFile(command, `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) {console.log('0.85.0');process.exit(0);}
writeFileSync('launch.json', JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),hasChronaDatabaseSecret:'CHRONA_DATABASE_SECRET' in process.env,tokenMatches:process.env.CHRONA_AGENT_TOKEN==='private-run-token'}));
const mode=${JSON.stringify(mode)};
let streaming=false, queue=0, cycle=0, retried=false;
const emit = x => process.stdout.write(JSON.stringify(x)+'\\r\\n');
const reply=(c,data={})=>emit({id:c.id,type:'response',command:c.type,success:true,data});
function run() {
 streaming=true; cycle++; emit({type:'agent_start'});
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
   reply(c,{sessionId:'retained-session',isStreaming:streaming,isCompacting:false,pendingMessageCount:queue});
  }
  if(c.type==='get_commands') reply(c,{commands:[]});
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
  const input: ProviderRunInput = { runId: "run", token: "private-run-token", lane: "foreground", cwd, sessionDir: join(cwd, ".chrona/sessions"), sessionId: "previous-id", prompt: "hello", deadline: new Date(Date.now() + 4000) };
  const commands = async () => (await readFile(join(cwd, "commands.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  return { cwd, command, agentDir, options, provider, input, commands };
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check().catch(() => false)) return; await Bun.sleep(10); }
  throw new Error("fixture did not reach expected state");
}
describe("Pi RPC provider", () => {
  test("session, tools, images, cwd and filtered environment", async () => {
    const f = await fixture();
    const before = process.env.CHRONA_DATABASE_SECRET;
    process.env.CHRONA_DATABASE_SECRET = "must-not-leak";
    try {
      const handle = f.provider.start({ ...f.input, images: [{ mime: "image/png", base64: "YWJj" }] });
      expect(await handle.done).toEqual({ outcome: "finished", sessionId: "retained-session", error: null });
      const launch = JSON.parse(await readFile(join(f.cwd, "launch.json"), "utf8"));
      expect(launch.cwd).toBe(f.cwd);
      expect(launch.hasChronaDatabaseSecret).toBe(false);
      expect(launch.tokenMatches).toBe(true);
      expect(launch.args[launch.args.indexOf("--session-id") + 1]).toBe("previous-id");
      const tools = launch.args[launch.args.indexOf("--tools") + 1].split(",");
      expect(tools).toContain("read"); expect(tools).toContain("chrona_reply"); expect(tools).not.toContain("bash"); expect(tools).not.toContain("web_search");
      expect((await f.commands()).find(c => c.type === "prompt").images).toEqual([{ type: "image", mimeType: "image/png", data: "YWJj" }]);
      expect(await f.provider.health()).toEqual({ available: true, sandboxed: false, error: null });
    } finally { if (before === undefined) delete process.env.CHRONA_DATABASE_SECRET; else process.env.CHRONA_DATABASE_SECRET = before; }
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
  test.each([false, true])("bwrap mounts (root=%s), share network, and enable bash/web", async rootRun => {
    const f = await fixture();
    const affair = join(f.cwd, "a".repeat(32));
    await mkdir(affair);
    await mkdir(f.input.sessionDir, { recursive: true });
    await mkdir(join(f.cwd, "unrelated"));
    await symlink(affair, join(f.cwd, "b".repeat(32)));
    const bwrap = join(f.cwd, "bwrap");
    await writeFile(bwrap, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nif(process.argv.includes('--version'))process.exit(0);\nconst a=process.argv.slice(2);writeFileSync('bwrap.json',JSON.stringify(a));const p=Bun.spawn(a.slice(a.indexOf('--')+1),{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exit(await p.exited);\n`, { mode: 0o755 });
    const provider = createPiProvider({ ...f.options, bwrap, workspaceRoot: rootRun ? f.cwd : undefined, webExtension: join(f.cwd, "web.ts") });
    expect((await provider.start(f.input).done).outcome).toBe("finished");
    const args = JSON.parse(await readFile(join(f.cwd, "bwrap.json"), "utf8"));
    expect(args).toContain("--die-with-parent"); expect(args).toContain("--ro-bind"); expect(args).toContain("--tmpfs"); expect(args).not.toContain("--unshare-net");
    expect(args[args.indexOf("--tools") + 1].split(",")).toContain("bash");
    expect(args[args.indexOf("--tools") + 1].split(",")).toContain("web_search");
    expect((await provider.health()).sandboxed).toBe(true);
    const mounts = args.flatMap((arg: string, i: number) => arg === "--bind" || arg === "--ro-bind" ? [{ mode: arg, source: args[i + 1], target: args[i + 2] }] : []);
    expect(mounts).toContainEqual({ mode: rootRun ? "--ro-bind" : "--bind", source: f.cwd, target: f.cwd });
    expect(mounts).toContainEqual({ mode: "--bind", source: f.agentDir, target: f.agentDir });
    expect(mounts.some((m: { source: string }) => m.source === join(process.env.HOME!, ".pi"))).toBe(false);
    if (rootRun) {
      expect(mounts).not.toContainEqual({ mode: "--bind", source: f.cwd, target: f.cwd });
      expect(mounts).toContainEqual({ mode: "--bind", source: affair, target: affair });
      expect(mounts).toContainEqual({ mode: "--bind", source: f.input.sessionDir, target: f.input.sessionDir });
      expect(mounts.some((m: { source: string }) => m.source === join(f.cwd, ".chrona") || m.source === join(f.cwd, "unrelated") || m.source === join(f.cwd, "b".repeat(32)))).toBe(false);
    }
  });
});
