import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPiProvider } from "../steward/pi-provider";
import { createExecutorBridge } from "./bridge";
import { ExecutorJournal, assignmentUnit } from "./journal";
import { createExecutorLauncher, inspectExecutorUnit } from "./process";
import { executorAssignmentSchema } from "@chrona/contracts/steward";
import fixture from "../../../contracts/fixtures/executor-v1/cases.json";

test("actual Provider and extension use empty local catalog, native hook budget and live RPC questions", async () => {
  const local = createExecutorBridge(), root = mkdtempSync(join(tmpdir(), "chrona-test-facade-")), profile = mkdtempSync(join(tmpdir(), "chrona-test-profile-"));
  const extension = resolve("external-plugins/pi-steward-agent/chrona-tools.ts"), command = join(root, "pi");
  writeFileSync(command, `#!${process.execPath}
import extension from ${JSON.stringify(extension)};
import {writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('0.85.0');process.exit(0)}
let hook,registered=0,streaming=false,stats=0;
await extension({on:(_,h)=>{hook=h},registerTool:()=>{registered++}});
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const reply=(c,data={})=>emit({id:c.id,type:'response',command:c.type,success:true,data});
let buffer='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);
if(c.type==='get_state')reply(c,{sessionId:'session-local',isStreaming:streaming,isCompacting:false,pendingMessageCount:0});
if(c.type==='get_commands')reply(c,{commands:[]});
if(c.type==='get_session_stats')reply(c,{sessionId:'session-local',tokens:{input:++stats,output:stats,cacheRead:0,cacheWrite:0,total:stats*2},cost:0});
if(c.type==='set_auto_retry'||c.type==='set_auto_compaction'||c.type==='clear_queue')reply(c);
if(c.type==='abort'){reply(c);process.exit(0)}
if(c.type==='prompt'){reply(c);streaming=true;emit({type:'agent_start'});const admitted=[];for(let i=0;i<5;i++){if(!hook()){admitted.push(i);emit({type:'tool_execution_start',toolName:'read',toolCallId:'native-'+i});emit({type:'tool_execution_end',toolName:'read',toolCallId:'native-'+i})}}writeFileSync('native.json',JSON.stringify({registered,admitted,forbiddenEnvPresent:'CHRONA_EXECUTOR_MANAGER_SENTINEL' in process.env,tools:process.argv[process.argv.indexOf('--tools')+1]}));emit({type:'extension_ui_request',id:'actual-pi-interaction',method:'input',title:'Question',message:'Continue?',timeout:3000})}
if(c.type==='extension_ui_response'){writeFileSync('answer.json',JSON.stringify(c));streaming=false;emit({type:'agent_end'});emit({type:'agent_settled'})}
}});process.stdin.on('end',()=>process.exit(0));
`, { mode: 0o755 });
  const progress: unknown[] = [], resources: unknown[] = [], usage: unknown[] = [], questions: unknown[] = [];
  try {
    const headers = { authorization: `Bearer ${local.token}` };
    expect(await (await fetch(`${local.agentUrl}/catalog`, { headers })).json()).toEqual({ tools: [] });
    expect((await fetch(`${local.agentUrl}/tools/m_files_read`, { method: "POST", headers, body: "{}" })).status).toBe(403);
    expect((await fetch(`${local.agentUrl}/catalog`, { headers: { authorization: "Bearer guessed-device-credential" } })).status).toBe(403);
    expect((await fetch(`${local.agentUrl}/catalog`, { headers: { ...headers, "x-forwarded-for": "127.0.0.1" } })).status).toBe(403);
    const assignment = executorAssignmentSchema.parse({ ...fixture.assignment, deadlineAt: new Date(Date.now() + 6000).toISOString() });
    const store = new ExecutorJournal(join(root, "journal"));
    const supervised = process.env.CHRONA_EXECUTOR_SYSTEMD_PROBE === "1";
    const provider = createPiProvider({ command, agentDir: profile, chronaExtension: extension, agentUrl: local.agentUrl, ...(supervised ? { launch: createExecutorLauncher(store, assignment) } : {}) });
    const handle = provider.start({ runId: "run-local", token: local.token, lane: "background", cwd: root, sessionDir: join(root, "sessions"), sessionId: null, prompt: "fixture", deadline: new Date(Date.now() + 6000), execution: { workId: "work-local", sessionId: "session-local", runId: "run-local", attemptId: "attempt-local" }, executionBudget: { maxToolCalls: 2 }, events: { progress: async value => { progress.push(value); }, resources: async value => { resources.push(value); }, usage: async value => { usage.push(value); }, question: async value => { questions.push(value); return { decision: "submit", value: "continue" }; } } });
    expect((await handle.done).outcome).toBe("finished");
    const native = JSON.parse(readFileSync(join(root, "native.json"), "utf8"));
    expect(native.forbiddenEnvPresent).toBe(false); expect(native.registered).toBe(0); expect(native.admitted).toEqual([0, 1]); expect(native.tools.split(",")).toContain("bash");
    expect(JSON.parse(readFileSync(join(root, "answer.json"), "utf8"))).toMatchObject({ id: "actual-pi-interaction", value: "continue" });
    expect(questions).toHaveLength(1); expect(progress.length).toBeGreaterThan(0); expect(resources).toHaveLength(1); expect(usage).toHaveLength(1);
    if (supervised) {
      const value = store.read(assignmentUnit(assignment));
      expect(value?.observation?.properties.SubState).toBe("exited");
      expect(JSON.stringify(value)).not.toContain(local.token);
      expect(inspectExecutorUnit(assignmentUnit(assignment)).LoadState).toBe("not-found");
      if (process.env.CHRONA_EXECUTOR_RECEIPT) writeFileSync(process.env.CHRONA_EXECUTOR_RECEIPT, JSON.stringify({ root, assignmentUnit: assignmentUnit(assignment), observation: value?.observation, native, questions: questions.length, progress: progress.length, usage: usage.length, resources: resources.length, unit: inspectExecutorUnit(assignmentUnit(assignment)) }, null, 2));
    }
  } finally { await local.close(); }
});
