import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type AgentProviderRegistration, type ProviderRunInput, type ProviderTranscriptItem } from "@chrona/contracts/steward";
import { agent } from "../../system/agent";
import { registerAgentProvider } from "../../agent-provider";
import { createRuns } from "../../runs";
import { callSync, enqueueCall, kernelOrigin, CallError } from "../../module-calls";
import { moduleSupervisor } from "../../module-supervisor";
import { testModuleProcess } from "../../module-test-process";
import { testDb } from "../../test-db";
import type { StewardPorts } from "../../ports";
import "../../module-effects";
import { registerSystemModules } from "../../system-modules";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); }, 30000);
const object = { type: "object", properties: {}, additionalProperties: true };
const string = { type: "string" };
const declaration: AgentProviderRegistration = {
  id: "offline", name: "Offline backend", protocolVersion: 1,
  capabilities: { conversation: true, completion: true, native: true, images: false, interactions: false, resume: true },
  endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", native: "native", complete: "complete", transcript: "transcript" },
};
async function fixture() {
  registerSystemModules();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-provider-kernel-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const workspaceId = (await db.workspace.create({ data: { name: "kernel launch tests" } })).id;
  const requests: { name: string; args: Record<string, unknown> }[] = [];
  let nativeFails = false, stopped = false, confirmStop = true;
  let transcript: ProviderTranscriptItem[] = [];
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    const { id: name, args } = event.trigger;
    requests.push({ name, args });
    if (name === "health") return { result: { name: "offline", supportsRunModel: true, complete: true, available: true, sandboxed: false, error: null } };
    if (name === "native") {
      if (nativeFails) throw new CallError("unknown", "Backend operation response lost");
      return { result: { response: { operationId: args.operationId, request: args.request, apiKey: "hidden-value" } } };
    }
    if (name === "abort" && confirmStop) stopped = true;
    if (name === "status") return { result: { operationId: args.operationId, outcome: stopped ? { outcome: "finished", sessionId: null, error: null } : null, failure: false } };
    if (name === "transcript") return { result: transcript };
    if (name === "complete") return { result: { text: "bounded completion", inputTokens: 2, outputTokens: 3 } };
    return { result: {} };
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); });
  const startProperties = Object.fromEntries(["operationId", "runId", "token", "lane", "cwd", "sessionDir", "prompt", "systemPrompt", "resources", "callbacks", "model", "configurationRevision"].map(key => [key, string]));
  Object.assign(startProperties, { sessionId: { type: ["string", "null"] }, deadline: { type: ["string", "null"] }, providerOptions: object, searchTools: { type: "boolean" }, execution: object, executionBudget: object, images: { type: "array", items: object }, extraTools: { type: "array", items: string }, hostPaths: { type: "array", items: string }, content: { type: "array", items: object } });
  const backend = await db.module.create({ data: { workspaceId, name: "test-backend", status: "active", activeHash: "backend-v1" } });
  const manifest = moduleManifestSchema.parse({ name: backend.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["runtime-callback.event"], tools: Object.values(declaration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: name === "health" ? {} : name === "start" ? startProperties : name === "native" ? { operationId: string, request: object } : name === "transcript" ? { sessionDir: string, limit: { type: "number" } } : name === "complete" ? { commandKey: string, prompt: string, system: string, model: string, thinking: string, configurationRevision: string, maxOutputTokens: { type: "number" }, timeoutMs: { type: "number" } } : { operationId: string, message: string } }, output: {} })).concat([{ name: "configure", description: "Provider configuration", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: {} }]) });
  await db.moduleVersion.create({ data: { moduleId: backend.id, hash: backend.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const backendCaller = { kind: "module" as const, module: backend.name, moduleId: backend.id, hash: backend.activeHash! };
  async function installCaller(name: string) {
    const row = await db.module.create({ data: { workspaceId, name, status: "active", activeHash: "caller-v1" } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["agent.run", "agent.native", "agent.read", "agent.stop"], model: { tier: "any", maxCalls: 2, maxOutputTokens: 20 } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    return { kind: "module" as const, module: name, moduleId: row.id, hash: row.activeHash! };
  }
  const caller = await installCaller("entry-app");
  async function invoke(name: string, args: Record<string, unknown>, key = name) { return agent.handle({ ports, workspaceId, caller, call: { id: key, key }, run: { eventKey: "execution:offline" } }, name, args); }
  async function run(key: string, extra: Record<string, unknown> = {}) { return await invoke("run", { prompt: "private-prompt", ...extra }, key) as { runId: string; contextId: string }; }
  async function claim(runId: string) {
    const claimed = await createRuns(ports, workspaceId).claimNext("background");
    expect(claimed?.runId).toBe(runId);
    const row = await db.run.findUniqueOrThrow({ where: { id: runId } });
    const input: ProviderRunInput = { runId, token: claimed!.token, lane: row.lane as "background", cwd: row.cwd, sessionDir: join(dataDir, "sessions", row.sessionId!, ".chrona", "sessions"), sessionId: null, prompt: row.prompt, systemPrompt: "system", resources: "configured", deadline: row.deadlineAt };
    return input;
  }
  return { db, ports, workspaceId, backendCaller, caller, installCaller, invoke, run, claim, requests, setTranscript: (value: ProviderTranscriptItem[]) => { transcript = value; }, failNative: () => { nativeFails = true; }, unconfirmedStop: () => { confirmStop = false; } };
}


import { Store } from "./state";
test("Chat minimum vertical uses actual kernel gateway and durable Agent receipts", async()=>{
 const f=await fixture(); await registerAgentProvider(f.ports,f.workspaceId,f.backendCaller,declaration);
 const origin={...kernelOrigin(f.workspaceId),caller:f.caller};
 await expect(enqueueCall({tx:f.db,ports:f.ports,origin,target:"agent.run",raw:{prompt:"offline"}},{key:"prohibited-async"})).rejects.toMatchObject({code:"invalid"});
 const dir=await mkdtemp(join(tmpdir(),"chat-real-gateway-")); let lose=true;
 const store=new Store(join(dir,"data"),join(dir,"content"),async(t,a,o)=>{ const {output}=await callSync(f.ports,origin,t,a,o); if(t==="agent.run"&&lose){lose=false;throw Object.assign(Error("lost accepted reply"),{code:"unknown"});} return output; });
 try {
  let c=store.create("offline");store.draft(c.id,{draft:"offline acceptance"},0);
  c=await store.operate(c.id,"stable-run","send",{}); expect(c.operations[0].status).toBe("unknown");
  c=await store.reconcile(c.id); expect(c.active.runId).toBeTruthy(); expect(await f.db.run.count()).toBe(1);
  expect(c.messages[0].text).toBe("offline acceptance");
  c=await store.operate(c.id,"stable-stop","stop",{}); expect(c.active).toBeNull(); expect(c.messages.at(-1).run.stopConfirmed).toBe(true);
 } finally {store.close();await rm(dir,{recursive:true,force:true});}
});
