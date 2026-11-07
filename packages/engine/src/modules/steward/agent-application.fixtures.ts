import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { testDb } from "./test-db";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { moduleSupervisor } from "./module-supervisor";
import { registerSystemModules } from "./system-modules";
import { registerLocalRuntime } from "./local-runtime";
import { resolveBuiltinRelease } from "./module-release";
import type { StewardPorts } from "./ports";
import "./module-effects";

export async function agentFixture() {
  const root = await mkdtemp("/tmp/chrona-agent-app-"), dataDir = join(root, "data"), resources = join(root, "builtin");
  await mkdir(dataDir); await mkdir(resources);
  await cp(resolve(import.meta.dir, "builtin/agent"), join(resources, "agent"), { recursive: true });
  await seedTestModuleRelease(resources, "agent");
  const cwd = join(root, "work"), profile = join(root, "profile"); await mkdir(cwd); await mkdir(profile, { mode: 0o700 });
  const command = join(root, "pi"), extension = join(root, "extension.ts");
  await writeFile(extension, "");
  await writeFile(command, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('0.85.0');process.exit(0)}
if(process.argv.includes('--no-session')){let prompt='';process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'fake',model:'fast',stopReason:'stop',content:[{type:'text',text:'fixture completion'}],usage:{input:3,output:4}}}));});}else{
let streaming=false,buffer='';
const emit=x=>console.log(JSON.stringify(x));
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const data=c.type==='get_state'?{sessionId:'fixture-session',isStreaming:streaming,isCompacting:false,pendingMessageCount:0}:c.type==='get_commands'?{commands:[]}:{};emit({type:'response',id:c.id,command:c.type,success:true,data});if(c.type==='prompt'){streaming=true;writeFileSync('started','yes');writeFileSync('pi.pid',String(process.pid));emit({type:'agent_start'});emit({type:'tool_execution_start',toolCallId:'fixture',toolName:'read'});}if(c.type==='abort'){streaming=false;emit({type:'agent_end'});emit({type:'agent_settled'});process.exit(0);}}});
process.stdin.on('end',()=>process.exit(0));}
`, { mode: 0o755 });
  const db = testDb(), workspace = await db.workspace.create({ data: { name: "agent-app" } });
  const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk");
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: sdk });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleBuiltinResources: resources, moduleSdk: sdk,
    sandbox: { ...sandbox.health, ...sandbox }, agentApplication: { startModule: sandbox.startModule, env: { CHRONA_AGENT_CONFIGURATION: JSON.stringify({ backend: "pi", pi: { command, agentDir: profile, expectedVersion: "0.85.0", chronaExtension: extension, agentUrl: "http://127.0.0.1:1/api/steward-agent", workspaceRoot: join(dataDir, "sessions") }, browser: { configured: "none", dir: join(root, "browser") } }) } } };
  registerSystemModules(); registerLocalRuntime();
  const release = await resolveBuiltinRelease(ports, "agent");
  await mkdir(join(dataDir, "platform/store"), { recursive: true });
  await cp(join(resources, "agent"), join(dataDir, "platform/store", release.hash), { recursive: true });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "agent", builtin: true, status: "active", activeHash: release.hash } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, source: "builtin", manifest: release.manifest, status: "approved", intent: {}, report: {} } });
  // The other release modules are outside this focused fixture.
  for (const name of ["web", "mcp", "files", "notify", "events"]) await db.module.create({ data: { workspaceId: workspace.id, name, builtin: true, status: "active", activeHash: "fixture" } });
  const until = new Date(Date.now() + 10000), token = "private-agent-run-token";
  await db.run.create({ data: { id: "agent-run", workspaceId: workspace.id, lane: "foreground", trigger: "message", status: "running", provider: "pi", tokenHash: createHash("sha256").update(token).digest("hex"), cwd, prompt: "", deadlineAt: until, leaseUntil: until } });
  return { root, ports, module, workspaceId: workspace.id, input: { runId: "agent-run", token, lane: "foreground" as const, cwd, sessionDir: join(cwd, ".sessions"), sessionId: null, prompt: "private-agent-prompt", systemPrompt: "", resources: "minimal" as const, deadline: until }, async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(root, { recursive: true, force: true }); } };
}
