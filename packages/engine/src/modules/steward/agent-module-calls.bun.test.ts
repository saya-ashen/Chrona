import { assertExecutionModuleIdle } from "./execution-module-guard";
import { test, expect } from "bun:test";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { localDirectoryIdentity } from "@chrona/workspaces";
import { createServerWorkspacePreparer } from "../../../../../apps/server/src/execution-server-workspace";
import { z } from "zod";
import { moduleManifestSchema, moduleAgentOutputs } from "@chrona/contracts/steward";
import { agentFixture as fixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { createExecutions } from "./execution";
import { createExecutionEventStore } from "./execution-event-store";
import { callSync, kernelOrigin } from "./module-calls";
import { createRuns, liveRuns } from "./runs";
import { createTools } from "./tools";
import { createProviderChannel } from "./provider-channel";
import { appendRunEventIn } from "./run-events";
import { startLocalProvider } from "./local-runtime";

test("ordinary SDK module calls Agent with real caller ownership and original model budget", async () => {
  const f = await fixture();
  try {
    await f.ports.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { maxCallsPerEvent: 1, maxOutputTokens: 100, dailyCalls: 1, eventTimeoutMs: 5000 } } } });
    await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, "agent.configure", { config: { tiers: { fast: { model: "fake/fast" } }, "preferred-timeout-ms": 5000 } });
    f.ports.provider = { name: "pi", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("Agent owns Pi"); }, async complete() { throw new Error("Agent owns completions"); } };
    f.ports.resolveExecutionProject = async (principal, projectRef) => {
      expect(principal.caller).toMatchObject({ kind: "module" });
      if (projectRef !== "allowed") throw new Error("Unauthorized project");
      return { projectRef, executor: "server", canonicalPath: f.input.cwd, baseline: "commit:fixture" };
    };
    f.ports.executionEvents = createExecutionEventStore(f.ports);
    f.ports.executions = createExecutions(f.ports);
    // A queue wake may itself await Agent; admission must return without awaiting that wake.
    f.ports.onQueued = () => new Promise<void>(() => {});
    const name = "agent-consumer", callerHash = "consumer-v1";
    const source = join(f.ports.dataDir, "platform/store", callerHash);
    await mkdir(source);
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>{try{return {result:await (()=>{const {'request-key':rk,'command-key':ck,...args}=JSON.parse(t.args.args);let tool=t.args.tool;if(args.kind==='execution'||args['execution-id']||['lookup','inspect','placement','locations','cleanup'].includes(tool))tool='work-'+tool;if(tool==='work-lookup')args.key=rk;if(typeof args.answer==='string'){try{args.answer=JSON.parse(args.answer)}catch{}}if(Array.isArray(args.tools))args.tools=args.tools.map(target=>{const i=target.indexOf('.');return {moduleId:chrona.dependencies[target.slice(0,i)],tool:target.slice(i+1)}});return chrona.call({moduleId:chrona.dependencies.agent,tool},args,{key:rk??ck})})()}}catch(e){return {result:{error:e.code,message:e.message}}}});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], uses: ["agent.start", "agent.status", "agent.abort", "agent.inject", "agent.release", "agent.transcript", "agent.complete", "agent.completion", "agent.health"], model: { tier: "fast", maxCalls: 1, maxOutputTokens: 100 }, tests: ["test.ts"], tools: [{ name: "relay", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: { tool: { type: "string" }, args: { type: "string" } }, required: ["tool", "args"] },
        output: {}
    }] });
    const consumer = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: callerHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: consumer.id, hash: callerHash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
    const relay = async (tool: string, args: Record<string, unknown>) => (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, name + ".relay", { tool, args: JSON.stringify(args) })).output;
    for (const tool of ["start", "status", "inject", "abort", "release", "transcript"]) {
      expect(await relay(tool, {})).toMatchObject({ error: "forbidden" });
    }
    const other = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "other-consumer", status: "active", activeHash: "v1" } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: other.id, hash: "v1", source: "user", manifest: { ...manifest, name: "other-consumer" }, status: "approved", intent: {}, report: {} } });
    const otherOrigin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: "other-consumer", moduleId: other.id, hash: "v1" } };
    await expect(callSync(f.ports, otherOrigin, "runtime-callback.agent-admit", { callId: "forged", operation: "start" })).rejects.toMatchObject({ code: "forbidden" });
    const modelInput = { "command-key": "model", prompt: "private prompt", "max-output-tokens": 100 };
    const completion = moduleAgentOutputs.complete.parse(await relay("complete", modelInput));
    expect(await relay("complete", modelInput)).toEqual(completion);
    const completionArgs = { "operation-id": completion.operationId };
    let finished: z.infer<typeof moduleAgentOutputs.completion> = { result: null, failure: false };
    for (let i = 0; i < 100; i++) { finished = moduleAgentOutputs.completion.parse(await relay("completion", completionArgs)); if (finished.result || finished.failure) break; await Bun.sleep(20); }
    expect(finished).toMatchObject({ result: { text: "fixture completion" }, failure: false });
    await expect(callSync(f.ports, otherOrigin, "agent.completion", completionArgs)).rejects.toMatchObject({ code: "forbidden" });
    expect(await relay("complete", { ...modelInput, "command-key": "second-model" })).toMatchObject({ error: "forbidden" });
    const budget = await f.ports.db.moduleCall.findMany({ where: { method: "model" }, orderBy: { createdAt: "asc" } });
    expect(budget).toHaveLength(2);
    expect(budget.map(row => [row.moduleId, row.hash, row.status])).toEqual([[consumer.id, callerHash, "executed"], [consumer.id, callerHash, "rejected"]]);
    const rows = await f.ports.db.moduleInvocation.findMany({ where: { target: { in: ["agent", "runtime-callback"] } } });
    expect(JSON.stringify(rows)).not.toContain("private prompt");
    expect(await relay("release", completionArgs)).toMatchObject({ error: "forbidden" });
  } finally { liveRuns.clear(); await f.close(); }
}, 30000);


test("Agent execution primitives preserve SDK caller, scoped streams and confirmed interrupt", async () => {
  const f = await fixture();
  try {
    f.ports.provider = { name: "pi", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("Agent owns Pi"); }, async complete() { throw new Error("Agent owns completions"); } };
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
    const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: f.input.cwd, env: { ...gitEnv, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", timeout: 5000 }).trim();
    git("init", "-q");
    await writeFile(join(f.input.cwd, "README.md"), "Agent execution fixture\n");
    git("add", "README.md");
    git("-c", "user.name=Agent fixture", "-c", "user.email=agent@example.invalid", "commit", "-qm", "Fixture baseline");
    const baseline = { kind: "commit" as const, digest: git("rev-parse", "HEAD") };
    f.ports.resolveExecutionPlacement = async (principal, placement) => {
      expect(principal.caller).toEqual({ kind: "module", moduleId: consumer.id, hash: callerHash });
      if (placement.executorId !== "server" || placement.projectRef !== "allowed" || placement.mappingRevision !== 1) throw new Error("Unauthorized project");
      return { ...placement, executor: "server", executorId: "server", executorGeneration: 1, canonicalPath: f.input.cwd, directoryIdentity: localDirectoryIdentity(f.input.cwd), baseline, label: "Agent fixture" };
    };
    f.ports.executionServerWorkspace = createServerWorkspacePreparer(f.ports.dataDir, f.ports.now);
    f.ports.executionEvents = createExecutionEventStore(f.ports);
    f.ports.executions = createExecutions(f.ports);
    // A queue wake may itself await Agent; admission must return without awaiting that wake.
    f.ports.onQueued = () => new Promise<void>(() => {});
    const name = "agent-consumer", callerHash = "consumer-v1";
    const source = join(f.ports.dataDir, "platform/store", callerHash);
    await mkdir(source);
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>{try{return {result:await (()=>{const {'request-key':rk,'command-key':ck,...args}=JSON.parse(t.args.args);let tool=t.args.tool;if(args.kind==='execution'||args['execution-id']||['lookup','inspect','placement','locations','cleanup'].includes(tool))tool='work-'+tool;if(tool==='work-lookup')args.key=rk;if(typeof args.answer==='string'){try{args.answer=JSON.parse(args.answer)}catch{}}if(Array.isArray(args.tools))args.tools=args.tools.map(target=>{const i=target.indexOf('.');return {moduleId:chrona.dependencies[target.slice(0,i)],tool:target.slice(i+1)}});return chrona.call({moduleId:chrona.dependencies.agent,tool},args,{key:rk??ck})})()}}catch(e){return {result:{error:e.code,message:e.message}}}});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], uses: ["agent.work-run", "agent.work-get", "agent.work-stream", "agent.work-write", "agent.work-interrupt", "agent.work-respond", "agent.work-lookup", "agent.work-inspect", "agent.work-placement", "agent.work-locations", "agent.work-cleanup", "agent.run", "agent.get", "agent.stream", "agent.write", "agent.interrupt", "agent.inspect", "agent.lookup", "agent.locations", "agent.start", "agent.status", "agent.abort", "agent.inject", "agent.release", "agent.transcript", "agent.complete", "agent.completion", "agent.health"], model: { tier: "fast", maxCalls: 1, maxOutputTokens: 100 }, tests: ["test.ts"], tools: [{ name: "relay", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: { tool: { type: "string" }, args: { type: "string" } }, required: ["tool", "args"] },
        output: {}
    }] });
    const consumer = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: callerHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: consumer.id, hash: callerHash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
    const relay = async (tool: string, args: Record<string, unknown>) => (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, name + ".relay", { tool, args: JSON.stringify(args) })).output;

    const start = { kind: "execution", "execution-id": "primitive", "request-key": "primitive-first", prompt: "bounded low level work", placement: { kind: "local", "project-ref": "allowed", "mapping-revision": 1 }, workspace: { mode: "existing", baseline }, "queue-expires-at": new Date(Date.now() + 60_000).toISOString(), budget: { "timeout-ms": 5000, "max-tool-calls": 5 } };
    const admitted = await relay("run", start) as {execution: import("@chrona/contracts/steward").ExecutionView};
    expect(admitted).toMatchObject({execution:{status:"queued", workId:"primitive"}});
    expect(await relay("run", start)).toEqual(admitted);
    expect(await relay("lookup", {"request-key":"primitive-first"})).toEqual(admitted.execution);
    const view = admitted.execution;
    const target = {"execution-id":view.workId,"run-id":view.runId,"attempt-id":view.attemptId};
    expect(await relay("get", {"execution-id":view.workId})).toEqual(view);
    expect(await relay("get", target)).toEqual(view);
    expect(await relay("get", {...target, "attempt-id":"stale-attempt"})).toMatchObject({error:"conflict"});
    expect(await relay("get", {...target, "run-id":"stale-run"})).toMatchObject({error:"conflict"});
    expect(await relay("stream", {...target,limit:20})).toMatchObject({events:[]});
    expect(await relay("run", {...start, prompt:"changed"})).toMatchObject({error:"conflict"});
    expect(await relay("run", {...start, "request-key":"forged-path", cwd:"/host"})).toMatchObject({error:"invalid"});
    const foreign = await f.ports.db.module.create({data:{workspaceId:f.workspaceId,name:"foreign",status:"active",activeHash:"v1"}});
    await f.ports.db.moduleVersion.create({data:{moduleId:foreign.id,hash:"v1",source:"user",manifest:{...manifest,name:"foreign"},status:"approved",intent:{},report:{}}});
    const foreignOrigin = {...kernelOrigin(f.workspaceId),caller:{kind:"module" as const,module:"foreign",moduleId:foreign.id,hash:"v1"}};
    for(const [tool,args] of [["get",{"execution-id":view.workId}],["stream",{...target,limit:20}],["interrupt",{...target,"request-key":"steal"}]] as const) { const { ["request-key"]: key, ...input } = args as Record<string, unknown>; await expect(callSync(f.ports,foreignOrigin,"agent.work-"+tool,input, key ? { key: String(key) } : {})).rejects.toMatchObject({code:"not_found"}); }
    const runs=createRuns(f.ports,f.workspaceId),claimed=await runs.claimNext("background");
    const handle=await startLocalProvider(f.ports,f.workspaceId,{...f.input,runId:claimed!.id,token:claimed!.token,cwd:claimed!.cwd,lane:"background",deadline:claimed!.deadlineAt});
    liveRuns.set(claimed!.id,handle);
    expect(await relay("write",{...target,"request-key":"input",text:"continue"})).toEqual({accepted:true});
    expect(await relay("interrupt",{...target,"request-key":"stop"})).toMatchObject({cancelRequested:true,stopConfirmed:false});
    await runs.finish(claimed!.id,await handle.done,{stopEvidence:"provider_exited"}); liveRuns.delete(claimed!.id);
    expect(await relay("get",{"execution-id":view.workId})).toMatchObject({status:"cancelled",stopConfirmed:true});
  } finally { liveRuns.clear(); await f.close(); }
},30000);

test("Agent contexts keep durable identity, scoped reads and interrupt evidence", async () => {
  const f = await fixture();
  try {
    f.ports.onQueued = () => new Promise<void>(() => {});
    const name = "context-consumer", callerHash = "context-v1";
    const source = join(f.ports.dataDir, "platform/store", callerHash);
    await mkdir(source);
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>{try{return {result:await (()=>{const {'request-key':rk,'command-key':ck,...args}=JSON.parse(t.args.args);let tool=t.args.tool;if(args.kind==='execution'||args['execution-id']||['lookup','inspect','placement','locations','cleanup'].includes(tool))tool='work-'+tool;if(tool==='work-lookup')args.key=rk;if(typeof args.answer==='string'){try{args.answer=JSON.parse(args.answer)}catch{}}if(Array.isArray(args.tools))args.tools=args.tools.map(target=>{const i=target.indexOf('.');return {moduleId:chrona.dependencies[target.slice(0,i)],tool:target.slice(i+1)}});return chrona.call({moduleId:chrona.dependencies.agent,tool},args,{key:rk??ck})})()}}catch(e){return {result:{error:e.code,message:e.message}}}});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], uses: ["agent.context", "agent.run", "agent.get", "agent.stream", "agent.write", "agent.interrupt", "agent.respond"], tests: ["test.ts"], tools: [{ name: "relay", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: { tool: { type: "string" }, args: { type: "string" } }, required: ["tool", "args"] },
        output: {}
    }] });
    const consumer = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: callerHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: consumer.id, hash: callerHash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
    const relay = async (tool: string, args: Record<string, unknown>) => (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, name + ".relay", { tool, args: JSON.stringify(args) })).output;
    const context = await relay("context", { "request-key": "context" }) as { contextId: string };
    expect(context.contextId).toBeString();
    expect(await relay("context", { "request-key": "context" })).toEqual(context);
    const input = { "context-id": context.contextId, "request-key": "run", prompt: "Module-owned explicit prompt", lane: "background" };
    const run = await relay("run", input) as { runId: string; contextId: string };
    expect(run).toMatchObject({ contextId: context.contextId, status: "queued", active: true });
    expect(await relay("run", input)).toEqual(run);
    expect(await relay("run", { ...input, "request-key": "concurrent" })).toMatchObject({ error: "conflict" });
    expect(await relay("run", { ...input, prompt: "changed" })).toMatchObject({ error: "conflict" });
    expect(await f.ports.db.run.count({ where: { sessionId: context.contextId } })).toBe(1);
    const target = { "run-id": run.runId };
    expect(await relay("get", target)).toEqual(run);
    expect(await relay("stream", { ...target, limit: 20 })).toMatchObject({ items: [], after: 0, ended: false });
    const foreign = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "foreign-context", status: "active", activeHash: "foreign-v1" } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: foreign.id, hash: "foreign-v1", source: "user", manifest: { ...manifest, name: "foreign-context" }, status: "approved", intent: {}, report: {} } });
    const foreignOrigin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: foreign.name, moduleId: foreign.id, hash: "foreign-v1" } };
    for (const [tool, args] of [["get", target], ["stream", target], ["interrupt", { ...target, "request-key": "steal" }], ["run", { ...input, "request-key": "foreign" }]] as const) {
      const { ["request-key"]: key, ...input } = args as Record<string, unknown>;
      await expect(callSync(f.ports, foreignOrigin, "agent." + tool, input, key ? { key: String(key) } : {})).rejects.toMatchObject({ code: "not_found" });
    }
    expect(await relay("write", { ...target, "request-key": "queued-write", text: "input" })).toMatchObject({ error: "conflict" });
    expect(await relay("respond", { ...target, "request-key": "bad-answer", "question-id": "missing", answer: "{" })).toMatchObject({ error: "invalid" });
    const interrupt = { ...target, "request-key": "queued-stop" };
    expect(await relay("interrupt", interrupt)).toMatchObject({ status: "cancelled", active: false });
    expect(await relay("interrupt", interrupt)).toMatchObject({ status: "cancelled", active: false });
    expect(await relay("get", target)).toMatchObject({ status: "cancelled", active: false });
    expect(await relay("stream", target)).toMatchObject({ ended: true });
    expect(await createRuns(f.ports, f.workspaceId).claimNext("background")).toBeNull();
    const sinkHash = "context-sink-v1", sinkSource = join(f.ports.dataDir, "platform/store", sinkHash);
    await mkdir(sinkSource);
    await writeFile(join(sinkSource, "index.ts"), `import {on} from 'chrona';on('tool',async t=>({result:{caller:t.caller}}));`);
    const sinkManifest = moduleManifestSchema.parse({ name: "context-sink", entry: "index.ts", effects: [], tests: ["test.ts"], tools: [{ name: "observe", description: "fixture", visibility: ["modules"], parameters: { type: "object", properties: {} },
        output: {}
    }] });
    const sink = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "context-sink", status: "active", activeHash: sinkHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: sink.id, hash: sinkHash, source: "user", manifest: sinkManifest, status: "approved", intent: {}, report: {} } });
    expect(await relay("run", { ...input, "request-key": "owner-escalation", tools: ["context-consumer.relay"] })).toMatchObject({ error: "forbidden" });
    const buildRequest = { name: "context-built", goal: "Verify original context admission", examples: [], intent: { changes: ["Add a deterministic fixture"], preserves: [] } };
    const moduleOrigin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: name, moduleId: consumer.id, hash: callerHash } };
    await expect(callSync(f.ports, moduleOrigin, "modules.build", buildRequest)).rejects.toMatchObject({ code: "not_found" });
    const running = await relay("run", { ...input, "request-key": "running", tools: ["context-sink.observe"] }) as { runId: string };
    const runs = createRuns(f.ports, f.workspaceId), claimed = await runs.claimNext("background");
    expect(claimed?.id).toBe(running.runId);
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, runId: claimed!.id, token: claimed!.token, cwd: claimed!.cwd, lane: "background", deadline: claimed!.deadlineAt });
    liveRuns.set(claimed!.id, handle);
    const tools = createTools(f.ports), catalog = await tools.catalog(claimed!.token);
    expect(catalog.map(tool => tool.name).sort()).toEqual(["m_context_sink_observe"]);
    await expect(tools.call(claimed!.token, "m_modules_build", buildRequest)).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.session.count({ where: { workspaceId: f.workspaceId, source: "build" } })).toBe(0);
    expect(await tools.call(claimed!.token, "m_context_sink_observe", {})).toMatchObject({ result: { caller: { kind: "module", moduleId: consumer.id, hash: callerHash } } });
    await expect(tools.call(claimed!.token, "chrona_preferences", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(tools.call(claimed!.token, "m_context_consumer_relay", {})).rejects.toMatchObject({ code: "forbidden" });
    const activeTarget = { "run-id": running.runId };
    expect(await relay("run", { ...input, "request-key": "concurrent" })).toMatchObject({ error: "conflict" });
    const write = { ...activeTarget, "request-key": "live-write", text: "continue the explicit prompt" };
    expect(await relay("write", write)).toEqual({ accepted: true });
    expect(await relay("write", write)).toEqual({ accepted: true });
    expect(await relay("write", { ...write, text: "changed" })).toMatchObject({ error: "conflict" });
    for (let seq = 1; seq <= 2; seq++) await f.ports.db.$transaction(tx => appendRunEventIn(tx, running.runId, "progress", { type: "progress", value: { phase: "working" } }, f.ports.now()));
    const logDir = join(f.ports.dataDir, "sessions", context.contextId, ".chrona", "sessions");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, "fixture.jsonl"), [
      { type: "message", timestamp: "2026-11-07T00:00:00Z", message: { role: "user", content: "private user prompt" } },
      { type: "message", timestamp: "2026-11-07T00:00:01Z", message: { role: "assistant", content: [{ type: "thinking", text: "private reasoning" }, { type: "text", text: "Visible model reply" }] } },
    ].map(row => JSON.stringify(row)).join("\n"));
    const textPage = await relay("stream", { ...activeTarget, limit: 10 }) as { transcript: unknown[] };
    expect(textPage.transcript).toEqual([{ at: "2026-11-07T00:00:01Z", kind: "text", text: "Visible model reply" }]);
    expect(JSON.stringify(textPage)).not.toContain(f.ports.dataDir);
    expect(JSON.stringify(textPage)).not.toContain("private reasoning");
    expect(JSON.stringify(textPage)).not.toContain("private user prompt");
    let questionReady!: (id: string) => void;
    const ready = new Promise<string>(resolve => { questionReady = resolve; });
    const channel = createProviderChannel(f.ports, { id: running.runId, workspaceId: f.workspaceId, sessionId: context.contextId, deadlineAt: claimed!.deadlineAt! }, async request => { questionReady(request.id); });
    const question = channel.events.question({ method: "confirm", title: "Continue?", message: "Approve this step", options: [], timeoutMs: 5000 }, new AbortController().signal);
    const questionId = await ready;
    expect(await relay("stream", activeTarget)).toMatchObject({ interactions: [{ id: questionId, status: "pending" }] });
    const answer = { ...activeTarget, "request-key": "confirm", "question-id": questionId, answer: JSON.stringify({ decision: "submit", value: true }) };
    expect(await relay("respond", answer)).toEqual({ accepted: true });
    expect(await relay("respond", answer)).toEqual({ accepted: true });
    expect(await question).toEqual({ decision: "submit", value: true });
    expect(await relay("stream", activeTarget)).toMatchObject({ interactions: [{ id: questionId, status: "answered" }] });
    await channel.close();
    const page = await relay("stream", { ...activeTarget, limit: 1 }) as { items: { sequence: number }[]; after: number };
    expect(page.items).toHaveLength(1); expect(page.after).toBe(1);
    expect(await relay("stream", { ...activeTarget, after: page.after, limit: 1 })).toMatchObject({ items: [{ sequence: 2 }], after: 2 });
    expect(await relay("interrupt", { ...activeTarget, "request-key": "live-stop" })).toMatchObject({ status: "running", active: true });
    await runs.finish(claimed!.id, await handle.done, { stopEvidence: "provider_exited" });
    liveRuns.delete(claimed!.id);
    expect(await relay("get", activeTarget)).toMatchObject({ status: "cancelled", active: false });
    expect(await f.ports.db.run.count({ where: { sessionId: context.contextId } })).toBe(2);
    const next = await relay("run", { ...input, "request-key": "after-stop" }) as { runId: string };
    const nextClaim = await runs.claimNext("background");
    expect(nextClaim!.id).toBe(next.runId);
    await runs.finish(next.runId, { outcome: "finished", sessionId: "continued-model-context", error: null }, { stopEvidence: "provider_exited" });
    expect(await f.ports.db.session.findUnique({ where: { id: context.contextId } })).toMatchObject({ status: "active", providerSessionId: "continued-model-context" });
    const failed = await relay("run", { ...input, "request-key": "fail" }) as { runId: string };
    expect((await runs.claimNext("background"))!.id).toBe(failed.runId);
    await runs.finish(failed.runId, { outcome: "failed", sessionId: null, error: "fixture failure" });
    expect(await relay("get", { "run-id": failed.runId })).toMatchObject({ status: "unknown", active: true });
    expect(await relay("stream", { "run-id": failed.runId })).toMatchObject({ ended: false });
    await expect(assertExecutionModuleIdle(f.ports.db, consumer.id)).rejects.toThrow("停止待确认");
    expect(await relay("run", { ...input, "request-key": "unconfirmed-restart" })).toMatchObject({ error: "conflict" });
    await runs.finish(failed.runId, { outcome: "failed", sessionId: null, error: "fixture failure" }, { stopEvidence: "provider_exited" });
    expect(await relay("get", { "run-id": failed.runId })).toMatchObject({ status: "failed", active: false });
    await assertExecutionModuleIdle(f.ports.db, consumer.id);
    expect(await runs.claimNext("background")).toBeNull();
    expect(await f.ports.db.run.count({ where: { sessionId: context.contextId } })).toBe(4);

  } finally { liveRuns.clear(); await f.close(); }
}, 30000);


test("SDK routed completion polls Agent under the original event budget without content in audits", async () => {
  const f = await fixture();
  try {
    await f.ports.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { maxCallsPerEvent: 1, maxOutputTokens: 100, dailyCalls: 10, eventTimeoutMs: 5000 } } } });
    await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, "agent.configure", { config: { tiers: { fast: { model: "fake/fast" } }, "preferred-timeout-ms": 5000 } });
    f.ports.provider = { name: "pi", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("Agent owns Pi"); }, async complete() { throw new Error("Agent owns completions"); } };
    const name = "sdk-model-consumer", hash = "sdk-model-v1", source = join(f.ports.dataDir, "platform/store", hash);
    await mkdir(source);
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';
on('tool',async event=>{
  const key = event.id + ':' + event.firedAt; const args = {prompt:'private SDK prompt','max-output-tokens':100};
  const started = await chrona.call({moduleId:chrona.dependencies.agent,tool:'complete'}, args, {key});
  const replay = await chrona.call({moduleId:chrona.dependencies.agent,tool:'complete'}, args, {key});
  if (replay.operationId !== started.operationId) throw new Error('completion receipt changed');
  let completion;
  const deadline = Date.now() + 5000;
  do {
    completion = await chrona.call({moduleId:chrona.dependencies.agent,tool:'completion'}, {'operation-id':started.operationId});
    if (completion.failure) throw new Error('completion failed');
    if (!completion.result) await Bun.sleep(10);
  } while (!completion.result && Date.now() < deadline);
  if (!completion.result) throw new Error('completion remains unconfirmed');
  let second;
  try { await chrona.call({moduleId:chrona.dependencies.agent,tool:'complete'}, {prompt:'second private SDK prompt','max-output-tokens':100}, {key:key+':second'}); }
  catch(e) { second={code:e.code,message:e.message}; }
  return {result:{first:completion.result,second}};
});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], uses: ["agent.complete", "agent.completion"], model: { tier: "fast", maxCalls: 1, maxOutputTokens: 100 }, tests: ["test.ts"], tools: [{ name: "exercise", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: {} },
        output: {}
    }] });
    const consumer = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: consumer.id, hash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
    const result = await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, name + ".exercise", {});
    expect(result.output).toMatchObject({ first: { text: "fixture completion", inputTokens: 3, outputTokens: 4 }, second: { code: "forbidden", message: expect.stringContaining("budget_exceeded: module model call") } });
    const calls = await f.ports.db.moduleCall.findMany({ where: { method: "model" }, orderBy: { createdAt: "asc" } });
    expect(calls.map(row => [row.moduleId, row.hash, row.status])).toEqual([[consumer.id, hash, "executed"], [consumer.id, hash, "rejected"]]);
    expect(calls.every(row => row.moduleRunId && row.eventKey)).toBe(true);
    const invocations = await f.ports.db.moduleInvocation.findMany();
    expect(invocations.some(row => row.target === "provider")).toBe(false);
    const logs = JSON.stringify({ invocations: invocations.filter(row => row.target === "agent" || row.target === "runtime-callback"), audits: await f.ports.db.audit.findMany(), calls });
    expect(logs).not.toContain("private SDK prompt");
    expect(logs).not.toContain("fixture completion");
  } finally { await f.close(); }
}, 30000);
