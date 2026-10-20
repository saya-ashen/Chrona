import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPiProvider } from "./pi-provider";
import type { ProviderAnswer, ProviderEvents, ProviderRunInput } from "@chrona/contracts/steward";
async function fixture(method = "confirm", unavailableStats = false, sensitive = false) {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-pi-events-")), profile = await mkdtemp(join(tmpdir(), "chrona-pi-events-profile-"));
  const command = join(cwd, "fake-pi"), bridge = join(cwd, "bridge.ts"); await writeFile(bridge, "");
  await writeFile(command, `#!${process.execPath}
import {appendFileSync,writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('0.85.0');process.exit(0)}
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n'),reply=(c,data={})=>emit({type:'response',id:c.id,success:true,data});
let started=false,completed=false,buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))!==-1){const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);appendFileSync('commands.jsonl',JSON.stringify(c)+'\\n');
 if(c.type==='get_state')reply(c,{sessionId:'fixture',isStreaming:started,isCompacting:false,pendingMessageCount:0});
 if(c.type==='get_commands')reply(c,{commands:[]});
 if(c.type==='get_session_stats'){if(${unavailableStats})continue;const total=completed?100:10;reply(c,{sessionId:'fixture',tokens:{input:total,output:0,cacheRead:0,cacheWrite:0,total},cost:total/1000});}
 if(c.type==='prompt'){if(${JSON.stringify(method)}==='handled'){reply(c,{disposition:'handled'});continue;}reply(c);started=true;emit({type:'agent_start'});emit({type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'PRIVATE_THINKING'}});emit({type:'tool_execution_start',toolName:'web_search',args:{private:'PRIVATE_ARGUMENTS'}});emit({type:'tool_execution_end',toolName:'web_search',result:{private:'PRIVATE_OUTPUT'}});emit({type:'extension_ui_request',id:'fixture-dialog',method:${JSON.stringify(method)},title:${sensitive}?'Fixture '+process.env.CHRONA_AGENT_TOKEN:'Fixture confirmation',message:${sensitive}?'password=hunter2':'Only this fixture',options:['Private choice A','Private choice B'],prefill:'DO_NOT_PERSIST_PREFILL'});}
 if(c.type==='extension_ui_response'){writeFileSync('answer.json',JSON.stringify(c));started=false;completed=true;emit({type:'agent_end'});emit({type:'agent_settled'});}
 if(c.type==='clear_queue')reply(c);
 if(c.type==='abort'){reply(c);started=false;emit({type:'agent_settled',aborted:true});}
}});process.stdin.on('end',()=>process.exit(0));
`, { mode: 0o755 });
  const seen: unknown[] = []; let answer!: (value: ProviderAnswer) => void, requested!: () => void;
  const question = new Promise<void>(resolve => { requested = resolve; });
  const events: ProviderEvents = { async progress(value) { seen.push(value); }, async usage(value) { seen.push(value); }, async resources(value) { seen.push(value); }, async question(value, signal) {
    seen.push(value); requested(); return new Promise<ProviderAnswer>(resolve => { answer = resolve; signal.addEventListener('abort', () => resolve({ decision: 'cancel' }), { once: true }); });
  } };
  const input: ProviderRunInput = { runId: "fixture", token: "known-fixture-token", lane: "foreground", cwd, sessionDir: join(cwd, "sessions"), sessionId: null, prompt: "Fixture only", deadline: new Date(Date.now() + 3000), events };
  const provider = createPiProvider({ command, agentDir: profile, chronaExtension: bridge, agentUrl: "http://127.0.0.1:1234/api/steward-agent" });
  return { cwd, input, provider, seen, question, answer: (value: ProviderAnswer) => answer(value) };
}
for (const [method, answer, expected] of [
  ["select", { decision: "submit", value: 1 }, { value: "Private choice B" }],
  ["confirm", { decision: "submit", value: false }, { confirmed: false }],
  ["input", { decision: "submit", value: "Owner's input" }, { value: "Owner's input" }],
  ["editor", { decision: "cancel" }, { cancelled: true }],
] as const) test(`Pi ${method}: waits for explicit reply and writes matching UI id without waiting for a normal response`, async () => {
  const f = await fixture(method), handle = f.provider.start(f.input); await f.question;
  expect(await Bun.file(join(f.cwd, "answer.json")).exists()).toBe(false);
  const serialized = JSON.stringify(f.seen);
  for (const secret of ["PRIVATE_THINKING", "PRIVATE_ARGUMENTS", "PRIVATE_OUTPUT", f.input.token, "hunter2"]) expect(serialized).not.toContain(secret);
  if (method === "editor") expect(f.seen).toContainEqual(expect.objectContaining({ prefill: "DO_NOT_PERSIST_PREFILL" }));
  else expect(serialized).not.toContain("DO_NOT_PERSIST_PREFILL");
  f.answer(answer);
  expect((await handle.done).outcome).toBe("finished");
  expect(JSON.parse(await readFile(join(f.cwd, "answer.json"), "utf8"))).toMatchObject({ type: "extension_ui_response", id: "fixture-dialog", ...expected });
  expect(f.seen).toContainEqual({ phase: "searching", tool: "web_search" });
  expect(f.seen).toContainEqual(expect.objectContaining({ scope: "run", total: 90, cost: 0.09000000000000001 }));
});
test("abort cannot turn an outstanding confirmation into a positive response", async () => {
  const f = await fixture(), handle = f.provider.start(f.input); await f.question;
  await handle.abort(); f.answer({ decision: "submit", value: true });
  expect((await handle.done).outcome).toBe("failed"); expect(await Bun.file(join(f.cwd, "answer.json")).exists()).toBe(false);
});
test("handled commands with no model turn finish without waiting for agent_settled", async () => {
  const f = await fixture("handled");
  expect((await f.provider.start(f.input).done).outcome).toBe("finished");
});
test("sensitive or incomplete request context cannot produce an approval", async () => {
  const f = await fixture("confirm", false, true), result = await f.provider.start(f.input).done;
  expect(result.outcome).toBe("failed"); expect(result.error).not.toContain(f.input.token);
  expect(JSON.stringify(f.seen)).not.toContain("hunter2");
  expect(await Bun.file(join(f.cwd, "answer.json")).exists()).toBe(false);
});
test("unsupported/hanging optional statistics do not prevent completion", async () => {
  const f = await fixture("confirm", true), handle = f.provider.start(f.input); await f.question; f.answer({ decision: "cancel" });
  expect((await handle.done).outcome).toBe("finished");
  expect(f.seen.some(value => typeof value === "object" && value !== null && "scope" in value)).toBe(false);
});
