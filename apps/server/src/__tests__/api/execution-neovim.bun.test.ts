import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExecutionResultSource, ExecutionView } from "@chrona/contracts/steward";

const repo = resolve(import.meta.dirname, "../../../../..");
const workbench = process.env.CHRONA_TEST_WORKBENCH ?? "/home/saya/workspace/agent-workbench.nvim";
const ownerKey = "synthetic-neovim-host-owner";
const moduleFile = (path: string) => JSON.stringify(join(repo, path));

// Same model-free JSONL protocol as pi-provider.bun.test.ts; this process also writes the real checkout.
const fakePi = `#!${process.execPath}
import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('0.85.0');process.exit(0)}
appendFileSync('launches.jsonl',JSON.stringify({pid:process.pid,at:Date.now(),cwd:process.cwd()})+'\\n');
writeFileSync('pi.pid',String(process.pid));
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const reply=(c,data={})=>emit({type:'response',id:c.id,command:c.type,success:true,data});
let streaming=false,mode='',asked=false,buffer='',timer;
function finish(){
 clearInterval(timer);streaming=false;writeFileSync('answer.json',JSON.stringify({confirmed:true,pid:process.pid}));
 writeFileSync('answer.txt','confirmed by another owner entry\\n');
 emit({type:'message_start',message:{role:'assistant'}});
 emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Updated answer.txt after detached confirmation.'}]}});
 emit({type:'agent_end'});emit({type:'agent_settled'});
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))!==-1){
 const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);
 appendFileSync('rpc.jsonl',JSON.stringify({type:c.type,confirmed:c.confirmed})+'\\n');
 if(c.type==='get_state')reply(c,{sessionId:'fake-host-session',isStreaming:streaming,isCompacting:false,pendingMessageCount:0});
 else if(c.type==='get_commands')reply(c,{commands:[]});
 else if(c.type==='get_session_stats')reply(c,{tokens:{input:1,output:1,total:2},cost:0});
 else if(c.type==='set_auto_retry'||c.type==='set_auto_compaction'||c.type==='clear_queue')reply(c);
 else if(c.type==='prompt'){
  reply(c);streaming=true;mode=c.message.includes('mode:complete')?'complete':'hold';emit({type:'agent_start'});
  timer=setInterval(()=>{
   appendFileSync('writer.log',process.pid+' '+Date.now()+'\\n');
   if(mode==='complete'&&!asked&&existsSync('client-detached')){
    asked=true;writeFileSync('after-detach.txt','written by '+process.pid+' after Neovim exited\\n');
    emit({type:'tool_execution_start',toolName:'write',toolCallId:'detached-write'});
    emit({type:'tool_execution_end',toolName:'write',toolCallId:'detached-write',result:{content:[{type:'text',text:'written'}]}});
    emit({type:'extension_ui_request',id:'pi-confirm',method:'confirm',title:'Keep detached edit?',message:'Confirm answer.txt',timeout:30000});
   }
  },40);
 }
 else if(c.type==='extension_ui_response'&&c.id==='pi-confirm'){if(c.confirmed===true)finish();else process.exit(9)}
 else if(c.type==='abort'){reply(c);clearInterval(timer);process.exit(0)}
}});
process.stdin.on('end',()=>{clearInterval(timer);process.exit(0)});
`;

// A separate OS process is necessary: killing an in-process object cannot test host restart recovery.
const hostSource = `
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {db} from ${moduleFile("packages/db/src/db.ts")};
import {createStewardRuntime} from ${moduleFile("apps/server/src/steward-runtime.ts")};
import {createServerApp} from ${moduleFile("apps/server/src/app.ts")};
import {createPiProvider} from ${moduleFile("packages/integrations/src/steward/pi-provider.ts")};
import {callSync} from ${moduleFile("packages/engine/src/modules/steward/module-calls.ts")};
import {moduleManifestSchema,PREINSTALLED_MODULE_NAMES} from ${moduleFile("packages/contracts/src/steward/index.ts")};
import {buildExecutionContracts} from ${moduleFile("build/execution-contracts.ts")};
import {startTestTickPump} from ${moduleFile("apps/server/src/test-tick-pump.ts")};
const root=process.env.CHRONA_TEST_ROOT;
const dataDir=join(root,'data');await mkdir(dataDir,{recursive:true});
const initialization={version:1,status:'complete',packages:Object.fromEntries(PREINSTALLED_MODULE_NAMES.map(name=>[name,{requestKey:'host:'+name,attempts:1,status:'skipped',moduleId:null,hash:null,approvalId:null,error:null}]))};
await db.workspace.upsert({where:{id:'host-workspace'},create:{id:'host-workspace',name:'Temporary host',settings:{moduleInitialization:initialization}},update:{}});
const external=join(root,'external');
for(const name of ['coding','editor'])await cp(${moduleFile("packages/engine/src/modules/steward/external")}+'/'+name,join(external,name),{recursive:true});
await buildExecutionContracts(external);
for(const name of ['coding','editor']){
 const hash='host-'+name;
 const code=join(dataDir,'platform/store',hash);
 await cp(join(external,name),code,{recursive:true});
 const manifest=moduleManifestSchema.parse(JSON.parse(await readFile(join(code,'module.json'),'utf8')));
 const row=await db.module.upsert({where:{workspaceId_name:{workspaceId:'host-workspace',name}},create:{id:hash,workspaceId:'host-workspace',name,activeHash:hash,status:'active',dataSchema:manifest.data.schema},update:{}});
 await db.moduleVersion.upsert({where:{moduleId_hash:{moduleId:row.id,hash}},create:{moduleId:row.id,hash,manifest,status:'approved',source:'user',intent:{},report:{}},update:{}});
}
await writeFile(join(dataDir,'execution-projects.json'),JSON.stringify({projects:[{workspaceId:'host-workspace',ownerId:'owner',moduleId:'host-coding',projectRef:'test-project',canonicalPath:join(root,'project'),baseline:'commit:'+process.env.CHRONA_TEST_BASELINE}]}));
let runtime,app;
const traffic=[],captureBeforeRelease=[],captureDirectories=new Map();
// Observe the real write boundary without issuing a nested DB query from its transaction.
const observedDb=db.$extends({query:{executionAttempt:{
 async create({args,query}){const row=await query(args);captureDirectories.set(row.id,row.logDir);return row},
 async update({args,query}){
  if(args.data.heldDirectory===null){
   const source=JSON.parse(await readFile(join(captureDirectories.get(args.where.id),'execution-changes.json'),'utf8'));
   captureBeforeRelease.push({attemptId:args.where.id,scope:source.changes.scope,status:source.changes.status,patchSha256:createHash('sha256').update(source.changes.patch).digest('hex')});
   await writeFile(join(root,'capture-before-release.json'),JSON.stringify(captureBeforeRelease));
  }
  return query(args);
 }
}}});
const server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:30,async fetch(request,server){
 const url=new URL(request.url);
 if(url.pathname.startsWith('/__test/')){
  if(request.headers.get('authorization')!=='Bearer '+process.env.API_KEY)return new Response('unauthorized',{status:401});
  if(url.pathname==='/__test/state')return Response.json({
   pid:process.pid,attempts:await db.executionAttempt.findMany({include:{run:true}}),
   questions:await db.audit.findMany({where:{kind:'provider_question'}}),
   answers:await db.audit.findMany({where:{kind:'provider_answer'}}),traffic,captureBeforeRelease,
  });
  if(url.pathname==='/__test/owner'){
   const input=await request.json();
   if(!['coding.answer','coding.get'].includes(input.target))return new Response('forbidden',{status:403});
   try{return Response.json({data:await callSync(runtime.ports,{workspaceId:'host-workspace',caller:{kind:'owner',via:null},chain:[],path:[]},input.target,{input:JSON.stringify(input.input)})})}
   catch(error){return Response.json({error:{code:error.code,message:error.message}},{status:409})}
  }
  return new Response('not found',{status:404});
 }
 if(url.pathname==='/api/editor/v1/commands'){
  const command=(await request.clone().json()).command;
  traffic.push({op:command.op,workId:command.workId});
 }else if(url.pathname==='/api/editor/v1/events')traffic.push({op:'events',workId:url.searchParams.get('workId')});
 else if(url.pathname==='/api/mcp'){
  const rpc=await request.clone().json();
  traffic.push({op:'mcp:'+rpc.method,tool:rpc.params?.name,target:rpc.params?.arguments?.name,ref:rpc.params?.arguments?.arguments?.ref});
 }
 return app?app.fetch(request,{server}):new Response('starting',{status:503});
}});
const provider=createPiProvider({command:join(root,'fake-pi'),agentDir:join(root,'profile'),expectedVersion:'0.85.0',chronaExtension:${moduleFile("external-plugins/pi-steward-agent/chrona-tools.ts")},agentUrl:'http://127.0.0.1:'+server.port+'/api/steward-agent',executionMode:'trusted-local'});
runtime=createStewardRuntime(observedDb,{dataDir,provider,onError:error=>console.error('HOST_RUNTIME',error)});
app=await createServerApp({steward:runtime});
await runtime.tickOnce();
await runtime.listener('/api/editor');
await writeFile(join(root,'ready.json'),JSON.stringify({url:'http://127.0.0.1:'+server.port,pid:process.pid}));
const stopTicks=startTestTickPump(()=>runtime.tickOnce(),100);
process.on('SIGTERM',()=>{void stopTicks().finally(async()=>{await runtime.stop();server.stop(true);await db.$disconnect()}).then(()=>process.exit(0),error=>{console.error(error);process.exit(1)})});
`;

const clientSource = `
vim.opt.runtimepath:prepend(vim.env.CHRONA_TEST_WORKBENCH)
local Client = require('agent-workbench.chrona.client')
local client = Client.new({url=vim.env.CHRONA_TEST_URL,project_ref='test-project',api_key=function()return '${ownerKey}' end})
local function request(command)
 local done,value,failure=false,nil,nil
 local accepted,err=client:request(command,function(data,e)value,failure,done=data,e,true end)
 assert(accepted,err)
 assert(vim.wait(15000,function()return done end,10),'HTTP callback timeout: '..command.op)
 assert(not failure,vim.inspect(failure))
 return value
end
local ok,err=pcall(function()
 local action=vim.env.CHRONA_TEST_ACTION
 local work=vim.env.CHRONA_TEST_WORK
 local receipt={pid=vim.fn.getpid()}
 if action=='start' then
  receipt.view=request({op='start',workId=work,projectRef='test-project',commandKey='start:'..work,goal=vim.env.CHRONA_TEST_GOAL,budget={timeoutMs=tonumber(vim.env.CHRONA_TEST_BUDGET),maxToolCalls=5}})
 else
  receipt.view=request({op='attach',workId=work})
  local target={workId=work,runId=receipt.view.runId,attemptId=receipt.view.attemptId}
  receipt.events=request(vim.tbl_extend('force',target,{op='events',limit=100,waitMs=0}))
  receipt.snapshot=request(vim.tbl_extend('force',target,{op='snapshot'}))
  receipt.results=request({op='results',workId=work})
  if #receipt.results.results>0 then
   local done,artifact,failure=false,nil,nil
   local result=receipt.results.results[1]
   local accepted,read_error=client:read_result_artifact(result,function(value,e)artifact,failure,done=value,e,true end)
   assert(accepted,read_error)
   assert(vim.wait(15000,function()return done end,10),'real owner MCP artifact callback timeout')
   assert(not failure,vim.inspect(failure))
   receipt.artifact=artifact
   local Chat=require('agent-workbench.ui.chat')
   local cleanup
   -- Only the surrounding UI owner is a stub; client/MCP/protocol/rendering are the original code.
   local remote={is_running=function()return true end,set_result_view=function(_,callback)if cleanup then cleanup()end;cleanup=callback end}
   local chat=setmetatable({_agent={remote=remote}},{__index=Chat})
   chat:_show_chrona_result(artifact,result)
   local buf=vim.api.nvim_get_current_buf()
   local function text()return table.concat(vim.api.nvim_buf_get_lines(buf,0,-1,false),'\\n')end
   local function key(value)for _,map in ipairs(vim.api.nvim_buf_get_keymap(buf,'n'))do if map.lhs==value then map.callback();return end end;error('missing result view key '..value)end
   receipt.resultView={summary=text(),readonly=vim.bo[buf].readonly,modifiable=vim.bo[buf].modifiable,buftype=vim.bo[buf].buftype,name=vim.api.nvim_buf_get_name(buf)}
   assert(receipt.resultView.readonly and not receipt.resultView.modifiable)
   key('p');receipt.resultView.patch=text()
   assert(vim.bo[buf].readonly and not vim.bo[buf].modifiable)
   assert(vim.bo[buf].filetype=='diff')
   key('q');assert(not vim.api.nvim_buf_is_valid(buf))
  end
  if action=='cancel' then receipt.cancel=request(vim.tbl_extend('force',target,{op='cancel',commandKey='cancel:'..work})) end
 end
 receipt.detach=request({op='detach',workId=work})
 client:close()
 vim.fn.writefile({vim.json.encode(receipt)},vim.env.CHRONA_TEST_RECEIPT)
end)
if ok then vim.cmd('qa!') else print(err);vim.cmd('cq 1') end
`;

type HostState = {
  pid: number;
  attempts: { id: string; runId: string; workId: string; heldDirectory: string | null; stopConfirmedAt: string | null; capabilityRevokedAt: string | null; cancelRequestedAt: string | null; run: { status: string } }[];
  questions: { details: { id: string; runId: string } }[];
  traffic: { op: string; workId?: string; tool?: string; target?: string; ref?: string }[];
  captureBeforeRelease: { attemptId: string; scope: string; status: string; patchSha256: string }[];
};
type Receipt = { pid: number; view: ExecutionView; artifact?: ExecutionResultSource; resultView?: { summary: string; patch: string; readonly: boolean; modifiable: boolean; buftype: string; name: string };  snapshot?: { status: string; stopConfirmed: boolean; finalMessage: { text: string } | null }; events?: { events: { payload: { type: string } }[] }; results?: { results: { artifactRef: string; baseline: { kind: string; digest: string } }[] } };

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    // An exited orphan may remain a zombie until the container's init reaps it.
    return !readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z");
  } catch { return false; }
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await Bun.sleep(30);
  }
  throw new Error(`Timed out: ${label}`);
}

async function fixture() {
  expect(existsSync(join(workbench, "lua/agent-workbench/chrona/client.lua"))).toBe(true);
  expect(Bun.which("nvim")).not.toBeNull();
  const root = await mkdtemp(join(tmpdir(), "chrona-neovim-host-"));
  const project = join(root, "project");
  await mkdir(project); await mkdir(join(root, "profile"), { mode: 0o700 });
  await writeFile(join(project, "answer.txt"), "baseline\n");
  await writeFile(join(project, ".gitignore"), "launches.jsonl\npi.pid\nrpc.jsonl\nwriter.log\nclient-detached\nafter-detach.txt\nanswer.json\n");
  await writeFile(join(root, "fake-pi"), fakePi, { mode: 0o755 });
  await writeFile(join(root, "host.ts"), hostSource);
  await writeFile(join(root, "client.lua"), clientSource);
  for (const args of [["init", "-q"], ["add", "answer.txt", ".gitignore"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"]]) {
    const child = Bun.spawn(["git", ...args], { cwd: project, stdout: "ignore", stderr: "pipe" });
    expect({ code: await child.exited, error: await new Response(child.stderr).text() }).toEqual({ code: 0, error: "" });
  }
  const git = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: project, stdout: "pipe" });
  const baseline = (await new Response(git.stdout).text()).trim();
  expect(await git.exited).toBe(0);
  const env = { PATH: process.env.PATH!, HOME: root, XDG_CONFIG_HOME: join(root, "xdg"), CHRONA_CONFIG_FILE: join(root, "missing-config.json"), NODE_ENV: "test", DATABASE_URL: `file:${join(root, "test.db")}`, CHRONA_MIGRATIONS_DIR: join(repo, "prisma/migrations"), CHRONA_TEST_ROOT: root, CHRONA_TEST_BASELINE: baseline, CHRONA_STEWARD_EXECUTION_MODE: "trusted-local", API_KEY: ownerKey };
  const hosts: ReturnType<typeof Bun.spawn>[] = [];
  const children = new Set<number>();
  let url = "";
  async function start() {
    const host = Bun.spawn([process.execPath, join(root, "host.ts")], { cwd: repo, env, stdout: Bun.file(join(root, `host-${hosts.length}.out`)), stderr: Bun.file(join(root, `host-${hosts.length}.err`)) });
    hosts.push(host);
    const ready = await until(async () => {
      if (host.exitCode !== null) throw new Error(`Host exited ${host.exitCode}: ${await readFile(join(root, `host-${hosts.length - 1}.err`), "utf8")}`);
      try { return JSON.parse(await readFile(join(root, "ready.json"), "utf8")) as { url: string; pid: number }; } catch { return null; }
    }, value => value?.pid === host.pid, "host ready");
    url = ready!.url;
    return host;
  }
  async function state(): Promise<HostState> {
    const response = await fetch(`${url}/__test/state`, { headers: { authorization: `Bearer ${ownerKey}` } });
    expect(response.status).toBe(200);
    return response.json();
  }
  async function client(action: string, work: string, goal = "mode:hold", budget = 30_000): Promise<Receipt> {
    const receipt = join(root, `${work}-${action}.json`);
    const child = Bun.spawn(["nvim", "--headless", "-u", "NONE", "-i", "NONE", "-l", join(root, "client.lua")], {
      cwd: project, env: { ...env, CHRONA_TEST_WORKBENCH: workbench, CHRONA_TEST_URL: url, CHRONA_TEST_ACTION: action, CHRONA_TEST_WORK: work, CHRONA_TEST_GOAL: goal, CHRONA_TEST_BUDGET: String(budget), CHRONA_TEST_RECEIPT: receipt }, stdout: "pipe", stderr: "pipe",
    });
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, out, error }).toEqual({ code: 0, out: "", error: "" });
    const value = JSON.parse(await readFile(receipt, "utf8")) as Receipt;
    expect(value.pid).toBe(child.pid);
    expect(alive(child.pid)).toBe(false);
    return value;
  }
  async function piPid() {
    return until(async () => Number(await readFile(join(project, "pi.pid"), "utf8").catch(() => "0")), value => value > 0 && alive(value), "live fake Pi PID");
  }
  async function captureChildren(pid: number) {
    const listed = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8").catch(() => "");
    for (const id of listed.trim().split(/\s+/).filter(Boolean).map(Number)) {
      children.add(id); await captureChildren(id);
    }
  }
  return { root, project, baseline, start, state, client, piPid,
    async owner(target: string, input: object) {
      const response = await fetch(`${url}/__test/owner`, { method: "POST", headers: { authorization: `Bearer ${ownerKey}`, "content-type": "application/json" }, body: JSON.stringify({ target, input }) });
      const body = await response.json();
      expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined });
      return body.data;
    },
    async crash(host: ReturnType<typeof Bun.spawn>) {
      await captureChildren(host.pid);
      host.kill("SIGKILL");
      expect(await host.exited).not.toBe(0);
      expect(alive(host.pid)).toBe(false);
    },
    async close() {
      for (const host of hosts) {
        if (host.exitCode === null) {
          await captureChildren(host.pid);
          host.kill("SIGTERM");
          await Promise.race([host.exited, Bun.sleep(5000)]);
          if (host.exitCode === null) { host.kill("SIGKILL"); await host.exited; }
        }
      }
      for (const pid of children) if (alive(pid)) process.kill(pid, "SIGKILL");
      await until(async () => [...children].filter(alive), value => value.length === 0, "task child cleanup");
      console.info(`Chrona/Neovim evidence: ${root}`);
    },
  };
}

test("real Neovim detaches while Pi writes and asks; owner answers, reopened client reviews, explicit cancel stops writer", async () => {
  const f = await fixture();
  try {
    await f.start();
    const first = await f.client("start", "detached", "mode:complete; edit answer.txt after the client exits");
    const pid = await f.piPid();
    expect(first.view.cancelRequested).toBe(false);
    expect(alive(pid)).toBe(true);
    // This marker can only be written after the actual Neovim process has exited.
    await writeFile(join(f.project, "client-detached"), String(first.pid));
    await until(async () => f.state(), value => value.questions.length === 1, "confirmation after Neovim exit");
    expect(await readFile(join(f.project, "after-detach.txt"), "utf8")).toContain(String(pid));
    expect(alive(pid)).toBe(true);
    const pending = await f.state();
    expect(pending.traffic.filter(item => item.workId === "detached").map(item => item.op)).toEqual(["start", "detach"]);
    expect(pending.attempts[0]!.cancelRequestedAt).toBeNull();
    const question = pending.questions[0]!.details;
    await f.owner("coding.answer", { workId: first.view.workId, runId: first.view.runId, attemptId: first.view.attemptId, requestId: question.id, commandKey: "owner-answer", answer: { decision: "submit", value: true } });
    await until(async () => f.state(), value => !!value.attempts[0]?.stopConfirmedAt, "actual Pi exit finalization");
    expect(alive(pid)).toBe(false);
    expect(await readFile(join(f.project, "answer.txt"), "utf8")).toBe("confirmed by another owner entry\n");
    const review = await f.client("review", "detached");
    expect(review.pid).not.toBe(first.pid);
    expect(review.view.status).toBe("completed");
    expect(review.snapshot?.finalMessage?.text).toContain("Updated answer.txt");
    expect(review.events?.events.some(event => event.payload.type === "message")).toBe(true);
    expect(review.results?.results).toHaveLength(1);
    expect(review.results!.results[0]!.baseline).toEqual({ kind: "commit", digest: f.baseline });
    const result = review.results!.results[0]!;
    expect(result.artifactRef).toStartWith("coding-result-");
    const artifactPath = join(f.root, "data/platform/content/host-coding", `${result.artifactRef}.json`);
    const artifactText = await readFile(artifactPath, "utf8");
    const artifact = JSON.parse(artifactText) as ExecutionResultSource;
    expect(result.artifactRef).toBe(`coding-result-${createHash("sha256").update(artifactText).digest("hex")}`);
    expect(review.artifact).toEqual(artifact);
    expect((await f.state()).traffic).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "mcp:initialize" }),
      expect.objectContaining({ op: "mcp:notifications/initialized" }),
      expect.objectContaining({ op: "mcp:tools/call", tool: "chrona_module_call", target: "content.read", ref: `coding/${result.artifactRef}.json` }),
    ]));
    expect(review.resultView).toMatchObject({ readonly: true, modifiable: false, buftype: "nofile", name: "" });
    expect(review.resultView!.summary).toContain("Changes: complete");
    expect(review.resultView!.summary).toContain(f.baseline);
    expect(review.resultView!.summary).toContain("tracked: answer.txt");
    expect(review.resultView!.patch).toContain("+confirmed by another owner entry");
    expect(artifact).toMatchObject({ workId: first.view.workId, sessionId: first.view.sessionId, runId: first.view.runId, attemptId: first.view.attemptId, baseline: { kind: "commit", digest: f.baseline } });
    expect(artifact.changes).toMatchObject({ scope: "baseline_to_worktree", status: "complete", files: [{ path: "answer.txt", kind: "tracked" }] });
    expect(artifact.changes!.patch).toContain("diff --git a/answer.txt b/answer.txt");
    expect(artifact.changes!.patch).toContain("-baseline");
    expect(artifact.changes!.patch).toContain("+confirmed by another owner entry");
    expect((await f.state()).captureBeforeRelease).toContainEqual({ attemptId: first.view.attemptId, scope: "baseline_to_worktree", status: "complete", patchSha256: createHash("sha256").update(artifact.changes!.patch).digest("hex") });
    // Released projects may change; the published artifact must retain the captured final version.
    await writeFile(join(f.project, "answer.txt"), "later checkout edit after directory release\n");
    const immutable = await f.client("review-again", "detached");
    expect(immutable.artifact).toEqual(artifact);
    expect(immutable.resultView!.patch).toBe(review.resultView!.patch);
    expect(await readFile(artifactPath, "utf8")).toBe(artifactText);
    const second = await f.client("start", "cancelled");
    const writingPid = await f.piPid();
    expect(writingPid).not.toBe(pid);
    await until(async () => readFile(join(f.project, "writer.log"), "utf8"), value => value.includes(String(writingPid)), "second live writer");
    const cancelled = await f.client("cancel", second.view.workId);
    expect(cancelled.pid).not.toBe(first.pid);
    await until(async () => f.state(), value => !!value.attempts.find(item => item.workId === "cancelled")?.stopConfirmedAt, "cancel exit proof");
    expect(alive(writingPid)).toBe(false);
    const text = await readFile(join(f.project, "writer.log"), "utf8");
    await Bun.sleep(150);
    expect(await readFile(join(f.project, "writer.log"), "utf8")).toBe(text);
    const stopped = (await f.state()).attempts.find(item => item.workId === "cancelled")!;
    expect(stopped.cancelRequestedAt).not.toBeNull();
    expect(stopped.heldDirectory).toBeNull();
  } finally { await f.close(); }
}, 90_000);

test("actual host death and same-SQLite restart retain unknown ownership without another Pi launch", async () => {
  const f = await fixture();
  try {
    const original = await f.start();
    const receipt = await f.client("start", "restart", "mode:hold; keep writing until stopped", 6000);
    const pid = await f.piPid();
    await until(async () => readFile(join(f.project, "writer.log"), "utf8").catch(() => ""), value => value.includes(String(pid)), "writer before host crash");
    await f.crash(original);
    const replacement = await f.start();
    expect(replacement.pid).not.toBe(original.pid);
    await until(async () => f.state(), value => !!value.attempts[0]?.capabilityRevokedAt, "expired original attempt after actual restart", 15_000);
    const review = await f.client("review", receipt.view.workId);
    expect(review.view).toMatchObject({ runId: receipt.view.runId, attemptId: receipt.view.attemptId, status: "unknown", stopConfirmed: false });
    expect(review.snapshot).toMatchObject({ status: "unknown", stopConfirmed: false });
    expect(review.results?.results).toEqual([]);
    const state = await f.state();
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]!.heldDirectory).toBe(f.project);
    const launches = (await readFile(join(f.project, "launches.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(launches).toEqual([expect.objectContaining({ pid, cwd: f.project })]);
    await Bun.sleep(250);
    expect((await readFile(join(f.project, "launches.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
  } finally { await f.close(); }
}, 60_000);
