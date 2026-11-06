import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PREINSTALLED_MODULE_NAMES } from "@chrona/contracts/steward";
import { moduleSupervisor } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { localDirectoryIdentity } from "../../../../../packages/integrations/src/executor/workspaces";
import { createPiProvider } from "../../../../../packages/integrations/src/steward/pi-provider";
import { resolveExternalRelease } from "../../../../../packages/engine/src/modules/steward/module-release";
import { callSync } from "../../../../../packages/engine/src/modules/steward/module-calls";
import { createStewardRuntime } from "../../steward-runtime";
import { createServerApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";

// Opt-in: real GUI needs the coordinator's exclusive heavy slot and installed Xvfb/Neovim tools.
test.skipIf(process.env.CHRONA_U_REAL_GUI !== "1")("real Neovim keyboard work wizard, questions, immutable comparison and cleanup", async () => {
  const root = await mkdtemp("/tmp/chrona-u-final-gui-test-");
  const evidence = process.env.CHRONA_U_GUI_EVIDENCE ?? root;
  await mkdir(evidence, { recursive: true });
  const db = testDb(), savedKey = process.env.API_KEY;
  const repo = resolve(import.meta.dirname, "../../../../..");
  const dataDir = join(root, "data"), externalRoot = join(root, "external"), project = join(root, "project");
  let runtime: ReturnType<typeof createStewardRuntime> | undefined;
  let app: Awaited<ReturnType<typeof createServerApp>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let gui: ReturnType<typeof Bun.spawn> | undefined;
  const traffic: object[] = [];
  const front = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 30, async fetch(request, server) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/__u_test/")) {
      if (request.headers.get("authorization") !== "Bearer synthetic-u-final-gui") return new Response("unauthorized", { status: 401 });
      if (path === "/__u_test/state") return Response.json({ attempts: await db.executionAttempt.findMany({ include: { run: true } }), questions: await db.audit.findMany({ where: { kind: "provider_question" } }), answers: await db.audit.findMany({ where: { kind: "provider_answer" } }), traffic });
      if (path === "/__u_test/owner") {
        const input = await request.json() as { target: string; input: object };
        if (!["coding.work", "coding.answer"].includes(input.target)) return new Response("forbidden", { status: 403 });
        try { const result = await callSync(runtime!.ports, { workspaceId: "ws_default", caller: { kind: "owner", via: null }, chain: [], path: [] }, input.target, { input: JSON.stringify(input.input) }); return Response.json(result.output); }
        catch (error) { return Response.json({ error: { code: (error as {code?: string}).code } }, { status: 409 }); }
      }
      return new Response("not found", { status: 404 });
    }
    if (path === "/api/editor/v1/commands") {
      const body = await request.clone().json() as {command: Record<string, unknown>};
      traffic.push({ entry: "editor", command: body.command });
    } else if (path === "/api/mcp") {
      const body = await request.clone().json() as {method: string;params?: {name?: string;arguments?: {name?: string;arguments?: object}}};
      traffic.push({ entry: "mcp", method: body.method, tool: body.params?.name, target: body.params?.arguments?.name, input: body.params?.arguments?.arguments });
    }
    return app ? app.fetch(request, { server }) : new Response("starting", { status: 503 });
  } });
  try {
    process.env.API_KEY = "synthetic-u-final-gui"; resetEnvCacheForTests();
    await mkdir(project); await mkdir(externalRoot); await mkdir(join(root, "profile"), { mode: 0o700 });
    await writeFile(join(project, "answer.txt"), "baseline source\n");
    const git = (args: string[]) => { const p = Bun.spawnSync(["git", "-C", project, ...args], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }); if (p.exitCode) throw new Error("Temporary Git fixture failed"); return p.stdout.toString().trim(); };
    git(["init", "--quiet"]); git(["add", "answer.txt"]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "--quiet", "-m", "baseline"]);
    const baseline = { kind: "commit", digest: git(["rev-parse", "HEAD"]) };
    const initialization = { version: 1, status: "complete", packages: Object.fromEntries(PREINSTALLED_MODULE_NAMES.map(name => [name, { requestKey: `gui:${name}`, attempts: 1, status: "skipped", moduleId: null, hash: null, approvalId: null, error: null }])) };
    await db.workspace.create({ data: { id: "ws_default", name: "U GUI temporary workspace", settings: { moduleInitialization: initialization } } });
    let codingId = "";
    for (const name of ["coding", "editor"]) {
      await cp(join(repo, "packages/engine/src/modules/steward/external", name), join(externalRoot, name), { recursive: true });
      const release = await resolveExternalRelease({ moduleExternalResources: externalRoot }, name);
      const module = await db.module.create({ data: { workspaceId: "ws_default", name, activeHash: release.hash, status: "active", dataSchema: release.manifest.data.schema } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, manifest: release.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
      await cp(release.codeDir, join(dataDir, "platform/store", release.hash), { recursive: true });
      if (name === "coding") codingId = module.id;
    }
    await writeFile(join(dataDir, "execution-projects.json"), JSON.stringify({ projects: [{ workspaceId: "ws_default", ownerId: "owner", moduleId: codingId, projectRef: "gui-project", canonicalPath: project, baseline: "commit:" + baseline.digest }], placements: [{ workspaceId: "ws_default", ownerId: "owner", moduleId: codingId, grant: { executor: "server", executorId: "server", executorGeneration: 1, projectRef: "gui-project", mappingRevision: 1, directoryIdentity: localDirectoryIdentity(project), baseline, label: "U GUI temporary server", canonicalPath: project } }] }));
    const fakePi = `#!${process.execPath}
import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
const root=${JSON.stringify(root)};
if(process.argv.includes('--version')){console.log('0.85.0');process.exit(0)}
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const reply=(c,data={})=>emit({type:'response',id:c.id,command:c.type,success:true,data});
let streaming=false,mode='',buffer='',timer;
function finish(){clearInterval(timer);streaming=false;if(mode!=='gui-clean')writeFileSync('answer.txt',mode+' finished\\n');emit({type:'message_start',message:{role:'assistant'}});emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:mode+' immutable completed'}]}});emit({type:'agent_end'});emit({type:'agent_settled'});}
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))!==-1){const c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);appendFileSync(root+'/rpc-types.jsonl',JSON.stringify({type:c.type,at:Date.now()})+'\\n');
if(c.type==='get_state')reply(c,{sessionId:'fake-gui-session',isStreaming:streaming,isCompacting:false,pendingMessageCount:0});
else if(c.type==='get_commands')reply(c,{commands:[]});
else if(c.type==='get_session_stats')reply(c,{tokens:{input:1,output:1,total:2},cost:0});
else if(['set_auto_retry','set_auto_compaction','clear_queue'].includes(c.type))reply(c);
else if(c.type==='prompt'){reply(c);streaming=true;mode=c.message.match(/gui-(?:question|parallel|dependent|clean|cancel)/)?.[0];writeFileSync(root+'/prompt-'+mode+'.txt',c.message);appendFileSync(root+'/launches.jsonl',JSON.stringify({mode,pid:process.pid,cwd:process.cwd(),at:Date.now()})+'\\n');emit({type:'agent_start'});
if(mode==='gui-question')timer=setInterval(()=>{if(existsSync(root+'/ask-gui-question')){clearInterval(timer);emit({type:'extension_ui_request',id:'gui-confirm',method:'confirm',title:'Keep exact child source?',message:'Confirm this child only',timeout:120000});}},50);
else if(mode==='gui-dependent'||mode==='gui-clean')setTimeout(finish,100);
else timer=setInterval(()=>{if(existsSync(root+'/finish-'+mode))finish()},50);}
else if(c.type==='extension_ui_response'&&c.id==='gui-confirm'){appendFileSync(root+'/answers.jsonl',JSON.stringify({mode,confirmed:c.confirmed})+'\\n');if(c.confirmed===true)finish();else process.exit(9)}
else if(c.type==='abort'){reply(c);clearInterval(timer);process.exit(0)}
}});process.stdin.on('end',()=>{clearInterval(timer);process.exit(0)});
`;
    await writeFile(join(root, "fake-pi"), fakePi, { mode: 0o755 });
    const provider = createPiProvider({ command: join(root, "fake-pi"), agentDir: join(root, "profile"), expectedVersion: "0.85.0", chronaExtension: join(repo, "external-plugins/pi-steward-agent/chrona-tools.ts"), agentUrl: front.url.origin + "/api/steward-agent", executionMode: "trusted-local" });
    runtime = createStewardRuntime(db, { dataDir, provider, onError: error => console.error("U_RUNTIME", error) }); runtime.ports.moduleExternalResources = externalRoot;
    const queued = runtime.ports.onQueued;
    runtime.ports.onQueued = async () => { console.info("U_QUEUED_BEGIN", Date.now()); await queued?.(); console.info("U_QUEUED_END", Date.now()); };
    await moduleSupervisor(runtime.ports).start(); app = await createServerApp({ steward: runtime });
    timer = setInterval(() => { console.info("U_TICK_BEGIN", Date.now()); void runtime!.tickOnce().then(() => console.info("U_TICK_END", Date.now())); }, 1000);
    await writeFile(join(evidence, "gui-driver.log"), ""); await writeFile(join(evidence, "gui-driver.err"), "");
    gui = Bun.spawn(["python3", join(import.meta.dirname, "editor-work-v2-gui.py")], { cwd: repo, env: { ...process.env, CHRONA_U_GUI_ROOT: root, CHRONA_U_GUI_EVIDENCE: evidence, CHRONA_U_GUI_URL: front.url.origin }, stdout: Bun.file(join(evidence, "gui-driver.log")), stderr: Bun.file(join(evidence, "gui-driver.err")) });
    const timeout = setTimeout(() => gui?.kill(), 180_000);
    const code = await gui.exited; clearTimeout(timeout);
    await writeFile(join(evidence, "traffic.json"), JSON.stringify(traffic, null, 2));
    await writeFile(join(evidence, "attempts.json"), JSON.stringify(await db.executionAttempt.findMany({ select: { workId: true, resolvedCwd: true, stopConfirmedAt: true, run: { select: { status: true, error: true } } } }), null, 2));
    expect({ code, error: code ? await readFile(join(evidence, "gui-driver.err"), "utf8") : "" }).toEqual({ code: 0, error: "" });
    expect(await db.executionAttempt.count()).toBeGreaterThanOrEqual(5);
  } finally {
    if (timer) clearInterval(timer);
    if (gui && gui.exitCode === null) { gui.kill(); await gui.exited; }
    await runtime?.stop(); front.stop(true); await db.$disconnect();
    if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey;
    resetEnvCacheForTests();
    console.info(`U final GUI temporary evidence: ${root}`);
  }
}, 200_000);
