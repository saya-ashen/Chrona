import { assertExecutionModuleIdle } from "./execution-module-guard";
import { test, expect } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture as fixture } from "./agent-application.fixtures";
import { createExecutions } from "./execution";
import { createExecutionEventStore } from "./execution-event-store";
import { callSync, kernelOrigin } from "./module-calls";
import { moduleAgentOutputs } from "./builtin/agent/module-contracts";
import { createRuns, liveRuns } from "./runs";
import { createTools } from "./tools";
import { createProviderChannel } from "./provider-channel";
import { startLocalProvider } from "./local-runtime";

test("ordinary SDK module calls Agent with real caller ownership and original model budget", async () => {
  const f = await fixture();
  try {
    await f.ports.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { models: { fast: "fake/fast" }, maxCallsPerEvent: 1, maxOutputTokens: 100, dailyCalls: 1, timeoutMs: 5000 } } } });
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
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>{try{return {result:await chrona.call('agent.'+t.args.tool,JSON.parse(t.args.args))}}catch(e){return {result:{error:e.code}}}});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], triggers: [], uses: ["agent.start", "agent.status", "agent.abort", "agent.inject", "agent.release", "agent.transcript", "agent.complete", "agent.completion", "agent.health"], model: { tier: "fast", maxCalls: 1, maxOutputTokens: 100 }, tests: ["test.ts"], tools: [{ name: "relay", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: { tool: { type: "string" }, args: { type: "string" } }, required: ["tool", "args"] } }] });
    const consumer = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: callerHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: consumer.id, hash: callerHash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
    const relay = async (tool: string, args: Record<string, unknown>) => (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, name + ".relay", { tool, args: JSON.stringify(args) })).output;
    const start = { "work-id": "delegated", "project-ref": "allowed", "command-key": "first", goal: "bounded work", budget: { "timeout-ms": 5000, "max-tool-calls": 5 } };
    const first = moduleAgentOutputs.start.parse(await relay("start", start));
    const operation = { "operation-id": first.operationId };
    expect(await relay("start", start)).toEqual(first);
    expect(await relay("start", { ...start, goal: "different" })).toMatchObject({ error: "conflict" });
    const status = moduleAgentOutputs.status.parse(await relay("status", operation));
    expect(status.execution.status).toBe("queued");
    const attempt = await f.ports.db.executionAttempt.findUniqueOrThrow({ where: { id: status.execution.attemptId } });
    expect(attempt).toMatchObject({ moduleId: consumer.id, callerHash });
    expect(await relay("start", { ...start, "command-key": "bad", cwd: "/tmp" })).toMatchObject({ error: "invalid" });
    expect(await relay("start", { input: "{}" })).toMatchObject({ error: "invalid" });
    expect(await relay("release", operation)).toMatchObject({ error: "conflict" });
    moduleAgentOutputs.transcript.parse(await relay("transcript", { ...operation, limit: 20 }));
    const other = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "other-consumer", status: "active", activeHash: "v1" } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: other.id, hash: "v1", source: "user", manifest: { ...manifest, name: "other-consumer" }, status: "approved", intent: {}, report: {} } });
    const otherOrigin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: "other-consumer", moduleId: other.id, hash: "v1" } };
    for (const tool of ["status", "inject", "abort", "release", "transcript"]) {
      const args = ["inject", "abort"].includes(tool) ? { ...operation, "command-key": "steal", ...(tool === "inject" ? { message: "steal" } : {}) } : operation;
      await expect(callSync(f.ports, otherOrigin, "agent." + tool, args)).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(callSync(f.ports, otherOrigin, "runtime-callback.agent-admit", { callId: "forged", operation: "start" })).rejects.toMatchObject({ code: "forbidden" });
    const runs = createRuns(f.ports, f.workspaceId), claimed = await runs.claimNext("background");
    expect(claimed?.id).toBe(status.execution.runId);
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, runId: claimed!.id, token: claimed!.token, cwd: claimed!.cwd, lane: "background", deadline: claimed!.deadlineAt });
    liveRuns.set(claimed!.id, handle);
    expect(await relay("inject", { ...operation, "command-key": "input", message: "Continue fixture" })).toEqual({ accepted: true });
    expect(await relay("abort", { ...operation, "command-key": "stop" })).toEqual({ requested: true });
    await runs.finish(claimed!.id, await handle.done, { stopEvidence: "provider_exited" });
    liveRuns.delete(claimed!.id);
    expect(moduleAgentOutputs.status.parse(await relay("status", operation)).execution).toMatchObject({ status: "cancelled", stopConfirmed: true });
    expect(await relay("release", operation)).toEqual({ released: true });
    expect(await relay("status", operation)).toMatchObject({ error: "not_found" });
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
    expect(await relay("release", completionArgs)).toEqual({ released: true });
  } finally { liveRuns.clear(); await f.close(); }
}, 30000);


test("Agent execution primitives preserve SDK caller, scoped streams and confirmed interrupt", async () => {
  const f = await fixture();
  try {
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
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>{try{return {result:await chrona.call('agent.'+t.args.tool,JSON.parse(t.args.args))}}catch(e){return {result:{error:e.code}}}});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], triggers: [], uses: ["agent.run", "agent.get", "agent.stream", "agent.write", "agent.interrupt", "agent.inspect", "agent.lookup", "agent.locations", "agent.start", "agent.status", "agent.abort", "agent.inject", "agent.release", "agent.transcript", "agent.complete", "agent.completion", "agent.health"], model: { tier: "fast", maxCalls: 1, maxOutputTokens: 100 }, tests: ["test.ts"], tools: [{ name: "relay", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: { tool: { type: "string" }, args: { type: "string" } }, required: ["tool", "args"] } }] });
    const consumer = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: callerHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: consumer.id, hash: callerHash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
    const relay = async (tool: string, args: Record<string, unknown>) => (await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, name + ".relay", { tool, args: JSON.stringify(args) })).output;

    const start = { "execution-id": "primitive", "project-ref": "allowed", "request-key": "primitive-first", prompt: "bounded low level work", budget: { "timeout-ms": 5000, "max-tool-calls": 5 } };
    const admitted = await relay("run", start) as {execution: import("@chrona/contracts/steward").ExecutionView};
    expect(admitted.execution).toMatchObject({status:"queued", workId:"primitive"});
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
    expect(await relay("run", {...start, cwd:"/host"})).toMatchObject({error:"invalid"});
    const foreign = await f.ports.db.module.create({data:{workspaceId:f.workspaceId,name:"foreign",status:"active",activeHash:"v1"}});
    await f.ports.db.moduleVersion.create({data:{moduleId:foreign.id,hash:"v1",source:"user",manifest:{...manifest,name:"foreign"},status:"approved",intent:{},report:{}}});
    const foreignOrigin = {...kernelOrigin(f.workspaceId),caller:{kind:"module" as const,module:"foreign",moduleId:foreign.id,hash:"v1"}};
    for(const [tool,args] of [["get",{"execution-id":view.workId}],["stream",{...target,limit:20}],["interrupt",{...target,"request-key":"steal"}]] as const) await expect(callSync(f.ports,foreignOrigin,"agent."+tool,args)).rejects.toMatchObject({code:"not_found"});
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
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async t=>{try{return {result:await chrona.call('agent.'+t.args.tool,JSON.parse(t.args.args))}}catch(e){return {result:{error:e.code}}}});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], triggers: [], uses: ["agent.context", "agent.run", "agent.get", "agent.stream", "agent.write", "agent.interrupt", "agent.respond"], tests: ["test.ts"], tools: [{ name: "relay", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: { tool: { type: "string" }, args: { type: "string" } }, required: ["tool", "args"] } }] });
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
      await expect(callSync(f.ports, foreignOrigin, "agent." + tool, args)).rejects.toMatchObject({ code: "not_found" });
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
    const sinkManifest = moduleManifestSchema.parse({ name: "context-sink", entry: "index.ts", effects: [], triggers: [], tests: ["test.ts"], tools: [{ name: "observe", description: "fixture", visibility: ["modules"], parameters: { type: "object", properties: {} } }] });
    const sink = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "context-sink", status: "active", activeHash: sinkHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: sink.id, hash: sinkHash, source: "user", manifest: sinkManifest, status: "approved", intent: {}, report: {} } });
    expect(await relay("run", { ...input, "request-key": "owner-escalation", tools: ["context-consumer.relay"] })).toMatchObject({ error: "forbidden" });
    const buildRequest = { name: "context-built", goal: "Verify original context admission", examples: [], intent: { changes: ["Add a deterministic fixture"], preserves: [] } };
    const moduleOrigin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: name, moduleId: consumer.id, hash: callerHash } };
    await expect(callSync(f.ports, moduleOrigin, "modules.build", buildRequest)).rejects.toMatchObject({ code: "forbidden" });
    const running = await relay("run", { ...input, "request-key": "running", tools: ["context-sink.observe", "modules.build"] }) as { runId: string };
    const runs = createRuns(f.ports, f.workspaceId), claimed = await runs.claimNext("background");
    expect(claimed?.id).toBe(running.runId);
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, runId: claimed!.id, token: claimed!.token, cwd: claimed!.cwd, lane: "background", deadline: claimed!.deadlineAt });
    liveRuns.set(claimed!.id, handle);
    const tools = createTools(f.ports), catalog = await tools.catalog(claimed!.token);
    expect(catalog.map(tool => tool.name).sort()).toEqual(["m_context_sink_observe", "m_modules_build"]);
    await f.ports.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { builds: { dailyLimit: 0, timeoutMinutes: 30, maxSubmissions: 3 } } } });
    await expect(tools.call(claimed!.token, "m_modules_build", buildRequest)).rejects.toThrow("Daily module build budget reached");
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
    for (let seq = 1; seq <= 2; seq++) await f.ports.db.audit.create({ data: { id: `provider:${running.runId}:${String(seq).padStart(8, "0")}`, workspaceId: f.workspaceId, kind: "provider_event", actorKey: "test", subjectId: running.runId, details: { type: "progress", value: { phase: "working" } } } });
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
    const next = await relay("run", { ...input, "request-key": "concurrent" }) as { runId: string };
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


test("SDK model polls Agent under the original event budget without content in audits", async () => {
  const f = await fixture();
  try {
    await f.ports.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { models: { fast: "fake/fast" }, maxCallsPerEvent: 1, maxOutputTokens: 100, dailyCalls: 10, timeoutMs: 5000 } } } });
    f.ports.provider = { name: "pi", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("Agent owns Pi"); }, async complete() { throw new Error("Agent owns completions"); } };
    const name = "sdk-model-consumer", hash = "sdk-model-v1", source = join(f.ports.dataDir, "platform/store", hash);
    await mkdir(source);
    await writeFile(join(source, "index.ts"), `import {chrona,on} from 'chrona';on('tool',async()=>{const first=await chrona.model({prompt:'private SDK prompt',maxOutputTokens:100});let second;try{await chrona.model({prompt:'second private SDK prompt',maxOutputTokens:100})}catch(e){second=e.code}return {result:{first,second}}});`);
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], triggers: [], uses: ["agent.complete", "agent.completion"], model: { tier: "fast", maxCalls: 1, maxOutputTokens: 100 }, tests: ["test.ts"], tools: [{ name: "exercise", description: "fixture", visibility: ["owner"], parameters: { type: "object", properties: {} } }] });
    const consumer = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: consumer.id, hash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
    const result = await callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, name + ".exercise", {});
    expect(result.output).toMatchObject({ first: { text: "fixture completion", inputTokens: 3, outputTokens: 4 }, second: "budget_exceeded" });
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
