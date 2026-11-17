import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { assembleModuleDependencies, stageModuleMaterial } from "../../build/agent-dependencies";
import { testDb } from "../../packages/kernel/src/test-db";
import { createScriptSandbox } from "../../packages/host/src/runtime/script-sandbox";
import { seedTestModuleRelease } from "../../packages/kernel/src/modules/module-release-test-fixture";
import { moduleSupervisor } from "../../packages/kernel/src/modules/module-supervisor";
import { registerSystemModules } from "../../packages/kernel/src/system-modules";
import { registerLocalRuntime } from "../../packages/kernel/src/execution/local-runtime";
import { resolveExternalRelease } from "../../packages/kernel/src/modules/module-release";
import { buildPiApplication } from "../../.generated/applications/pi/build";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "../../packages/kernel/src/ports";
import "../../packages/kernel/src/modules/module-effects";

/** Assemble locally available packages and resolve only this release's declared vendor closure. */
export async function linkPiFixtureDependencies(moduleDir: string) {
  await assembleModuleDependencies(moduleDir);
  await stageModuleMaterial(moduleDir, { artifacts: ["runtime.js", "test.js", "vendor"], build: { commands: ["bun build.ts", "assembleModuleDependencies"], toolchain: `bun ${Bun.version}`, target: "bun" } });
  const manifest = JSON.parse(await readFile(join(moduleDir, "package.json"), "utf8"));
  for (const name of ["@chrona/contracts", "@chrona/logging", "@chrona/pi", "zod"]) {
    if (manifest.dependencies?.[name] !== `file:vendor/${name}`) throw new Error(`Pi release is missing its declared file:vendor dependency: ${name}`);
  }
  await rm(join(moduleDir, "node_modules"), { recursive: true, force: true });
  for (const [name, specifier] of Object.entries(manifest.dependencies) as [string, string][]) {
    if (specifier !== `file:vendor/${name}`) throw new Error(`Pi fixture cannot resolve non-vendored dependency: ${name}`);
    const vendor = join(moduleDir, "vendor", name), link = join(moduleDir, "node_modules", name);
    const packaged = JSON.parse(await readFile(join(vendor, "package.json"), "utf8"));
    if (packaged.name !== name) throw new Error(`Pi vendored package identity changed: ${name}`);
    for (const dependency of Object.keys(packaged.dependencies ?? {})) {
      if (!manifest.dependencies[dependency]) throw new Error(`Pi vendor closure is incomplete: ${name} -> ${dependency}`);
    }
    await mkdir(dirname(link), { recursive: true });
    await symlink(relative(dirname(link), vendor), link);
  }
}

async function activatedPiRegistration(ports: StewardPorts, workspaceId: string, moduleId: string, hash: string) {
  let registration = await ports.db.agentProvider.findUnique({ where: { workspaceId_id: { workspaceId, id: "pi" } } });
  for (let i = 0; i < 150 && !registration; i++) {
    await Bun.sleep(20);
    registration = await ports.db.agentProvider.findUnique({ where: { workspaceId_id: { workspaceId, id: "pi" } } });
  }
  if (!registration || registration.moduleId !== moduleId || registration.hash !== hash) {
    const runs = await ports.db.moduleRun.findMany({ where: { moduleId } });
    throw new Error(`Pi activation did not register its actual release: ${JSON.stringify(runs)}`);
  }
  for (let i = 0; i < 150; i++) {
    // Keyless agent.register leaves no ledger row; the finished activated handler proves it returned.
    if (await ports.db.moduleRun.findFirst({ where: { moduleId, hash, triggerId: "activated", exitCode: 0 } })) return registration;
    await Bun.sleep(20);
  }
  throw new Error("Pi registered its row but activated agent.register never returned; inspect recursive provider health delivery during registration");
}

export async function agentFixture() {
  const root = await mkdtemp("/tmp/chrona-agent-app-"), dataDir = join(root, "data"), resources = join(root, "external");
  let cleanup = () => rm(root, { recursive: true, force: true });
  try {
  await mkdir(dataDir); await mkdir(resources);
  await cp(resolve(import.meta.dir, "../../.generated/applications/pi"), join(resources, "pi"), { recursive: true });
  // Build only the temporary release so the fake and gateway exercise the same current contract.
  await buildPiApplication(join(resources, "pi"));
  await linkPiFixtureDependencies(join(resources, "pi"));
  await seedTestModuleRelease(resources, "pi");
  const cwd = join(root, "work"), profile = join(root, "profile"); await mkdir(cwd); await mkdir(profile, { mode: 0o700 });
  const command = join(root, "pi"), extension = join(root, "extension.ts");
  await writeFile(extension, "");
  await writeFile(command, `#!${process.execPath}\nimport {writeFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(process.argv.includes('--version')){console.log('1.5.0');process.exit(0)}
if(process.argv.includes('--no-session')){
  for await (const chunk of process.stdin) {};
  appendFileSync(new URL('./completions.jsonl',import.meta.url),JSON.stringify({pid:process.pid})+'\\n');
  const args=process.argv.slice(2), hooks=new Map();
  const extension=await import(pathToFileURL(args[args.indexOf('-e')+1]).href);
  extension.default({on:(name,handler)=>hooks.set(name,handler)});
  const model=args[args.indexOf('--model')+1], separator=model.indexOf('/');
  const provider=separator<0?'fake':model.slice(0,separator), id=separator<0?model:model.slice(separator+1);
  // The real generated token-limit hook bounds the final payload and writes its confirmation.
  hooks.get('before_provider_request')({payload:{max_completion_tokens:65536}},{model:{provider,id,api:'openai-completions'}});
  console.log(JSON.stringify({type:'message_end',message:{role:'assistant',provider,model:id,stopReason:'stop',content:[{type:'text',text:'fixture completion'}],usage:{input:3,output:4}}}));
}else{
let streaming=false,buffer='';
const emit=x=>console.log(JSON.stringify(x));
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);appendFileSync('commands.jsonl',JSON.stringify(c)+'\\n');const data=c.type==='get_state'?{sessionId:'fixture-session',isStreaming:streaming,isCompacting:false,pendingMessageCount:0}:c.type==='get_commands'?{commands:[]}:c.type==='future_backend_feature'?{value:c.value,nested:c.nested}:{};emit({type:'response',id:c.id,command:c.type,success:true,data,...(c.type==='future_backend_feature'?{backendField:{retained:true}}:{})});if(c.type==='future_backend_feature')emit({type:'future_notice',nested:c.nested});if(c.type==='prompt'){streaming=true;writeFileSync('started','yes');writeFileSync('pi.pid',String(process.pid));emit({type:'agent_start'});emit({type:'tool_execution_start',toolCallId:'fixture',toolName:'read'});if(c.message?.includes('acceptance-question'))emit({type:'extension_ui_request',id:'backend-question',method:'confirm',title:'Continue?',message:'Offline question',timeout:30000});}if(c.type==='abort'){streaming=false;emit({type:'agent_end'});emit({type:'agent_settled'});process.exit(0);}}});
process.stdin.on('end',()=>process.exit(0));}
`, { mode: 0o755 });
  const db = testDb({ injectedAgent: false }), workspace = await db.workspace.create({ data: { name: "agent-app" } });
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(item => item.name === "main")!.file;
  const sdk = resolve(import.meta.dir, "../../packages/app-sdk");
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: sdk });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleExternalResources: resources, moduleSdk: sdk,
    sandbox: { ...sandbox.health, ...sandbox }, providerModules: { pi: { startModule: sandbox.startModule, env: { CHRONA_PROVIDER_CONFIGURATION: JSON.stringify({ command, agentDir: profile, expectedVersion: "1.5.0", chronaExtension: extension, agentUrl: "http://127.0.0.1:1/api/steward-agent", workspaceRoot: join(dataDir, "sessions") }) } } } };
  cleanup = async () => {
    try { await moduleSupervisor(ports).stop(); }
    finally { await db.$disconnect(); await rm(root, { recursive: true, force: true }); await rm(dirname(database), { recursive: true, force: true }); }
  };
  registerSystemModules(); registerLocalRuntime();
  const release = await resolveExternalRelease(ports, "pi");
  await mkdir(join(dataDir, "platform/store"), { recursive: true });
  await cp(join(resources, "pi"), join(dataDir, "platform/store", release.hash), { recursive: true });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "pi", builtin: false, status: "active", activeHash: release.hash } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, source: "external", manifest: release.manifest, status: "approved", intent: {}, report: {} } });
  await moduleSupervisor(ports).start();
  // Registration is delivered by the application's real activated handler, never seeded here.
  const registration = await activatedPiRegistration(ports, workspace.id, module.id, release.hash);
  // The other release modules are outside this focused fixture.
  for (const name of ["web", "mcp", "files", "notify", "events"]) await db.module.create({ data: { workspaceId: workspace.id, name, builtin: true, status: "active", activeHash: "fixture" } });
  const until = new Date(Date.now() + 60000), token = "private-agent-run-token";
  await db.run.create({ data: { id: "agent-run", workspaceId: workspace.id, lane: "foreground", trigger: "message", status: "running", provider: "pi", tokenHash: createHash("sha256").update(token).digest("hex"), cwd, prompt: "", deadlineAt: until, leaseUntil: until } });
  const { id: providerId, moduleId, hash, revision, declaration } = registration;
  await db.agentRunProvider.create({ data: { runId: "agent-run", providerId, moduleId, hash, revision, declaration: declaration as Prisma.InputJsonValue, providerOptions: {}, kind: "conversation" } });
  return { root, ports, module, registration, workspaceId: workspace.id, input: { runId: "agent-run", token, lane: "foreground" as const, cwd, sessionDir: join(cwd, ".sessions"), sessionId: null, prompt: "private-agent-prompt", systemPrompt: "", resources: "minimal" as const, deadline: until }, close: cleanup };
  } catch (error) { await cleanup(); throw error; }
}
