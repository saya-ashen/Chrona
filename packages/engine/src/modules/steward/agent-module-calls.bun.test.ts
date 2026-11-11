import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture as fixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { eventually } from "../../../../../scripts/agent-integration/registered-run.fixtures";
import { assertExecutionModuleIdle } from "./execution-module-guard";
import { callSync, kernelOrigin } from "./module-calls";
import { createRuns, liveRuns } from "./runs";
import { createTools } from "./tools";
import { createProviderChannel } from "./provider-channel";
import { appendRunEventIn } from "./run-events";
import { startLocalProvider } from "./local-runtime";

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Read = { run: { runId: string; status: string; active: boolean }; items: { sequence: number; kind: string; payload: unknown }[]; nextCursor: string; ended: boolean; interactions: { id: string; status: string }[]; transcript: unknown[] };
const owner = (f: Fixture) => ({ ...kernelOrigin(f.workspaceId), caller: { kind: "owner" as const, via: null } });
async function install(f: Fixture, name: string, source: string, tools = ["relay"], uses = ["agent.run", "agent.read", "agent.write", "agent.stop", "agent.native"]) {
  const hash = name + "-v1", directory = join(f.ports.dataDir, "platform/store", hash);
  await mkdir(directory); await writeFile(join(directory, "index.ts"), source);
  const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", effects: [], uses, model: { tier: "any", maxCalls: 1, maxOutputTokens: 100 }, tests: ["test.ts"],
    tools: tools.map(name => ({ name, description: "Offline SDK fixture", visibility: ["owner"], parameters: { type: "object", properties: name === "relay" ? { tool: { type: "string" }, args: { type: "string" }, key: { type: "string" } } : {} }, output: {} })) });
  const module = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash } });
  await f.ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, source: "user", manifest, status: "approved", intent: {}, report: {} } });
  return { module, hash, manifest, origin: { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: name, moduleId: module.id, hash } } };
}
const relaySource = `import {chrona,on} from 'chrona';on('tool',async t=>{try{return {result:await chrona.call('agent.'+t.args.tool,JSON.parse(t.args.args),t.args.tool==='read'?{}:{key:t.args.key})}}catch(e){return {result:{error:e.code,message:e.message}}}});`;

// The former work-* execution/placement/attempt test is Coding-owned. This
// integration follows only the public kernel Run/context protocol through SDK.
test("SDK Agent contexts preserve ownership, selected tools, scoped reads, interactions and confirmed stop evidence", async () => {
  const f = await fixture();
  try {
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "cancelled", stopStatus: "confirmed" } });
    f.ports.onQueued = () => new Promise<void>(() => {});
    const consumer = await install(f, "context-consumer", relaySource);
    const relay = async (tool: string, args: unknown, key = tool): Promise<unknown> => (await callSync(f.ports, owner(f), "context-consumer.relay", { tool, args: JSON.stringify(args), key })).output;
    const request = { providerId: "pi", prompt: "Module-owned explicit prompt", lane: "background" };
    expect(await relay("run", { ...request, cwd: "/host" }, "forged-path")).toMatchObject({ error: "invalid" });
    const first = (await relay("run", request, "first")) as { runId: string; contextId: string };
    expect(first).toMatchObject({ status: "queued", active: true });
    expect(await relay("run", request, "first")).toEqual(first);
    const input = { ...request, contextId: first.contextId };
    expect(await relay("run", input, "concurrent")).toMatchObject({ error: "conflict" });
    expect(await relay("run", { ...request, prompt: "changed" }, "first")).toMatchObject({ error: "conflict" });
    expect(await f.ports.db.run.count({ where: { sessionId: first.contextId } })).toBe(1);
    const target = { runId: first.runId };
    expect(await relay("read", target)).toMatchObject({ run: first, items: [], ended: false });
    const foreign = await install(f, "foreign-context", relaySource);
    for (const [tool, args] of [["read", target], ["stop", target], ["write", { ...target, input: { kind: "message", text: "steal" } }], ["run", input]] as const) {
      await expect(callSync(f.ports, foreign.origin, "agent." + tool, args, { key: "foreign-" + tool })).rejects.toMatchObject({ code: "not_found" });
    }
    expect(await relay("write", { ...target, input: { kind: "message", text: "input" } }, "queued-write")).toMatchObject({ error: "conflict" });
    expect(await relay("write", { ...target, input: { kind: "answer", questionId: "missing", answer: "{" } }, "bad-answer")).toMatchObject({ error: "invalid" });
    expect(await relay("stop", target, "queued-stop")).toMatchObject({ status: "cancelled", active: false, stopConfirmed: true });
    expect(await relay("stop", target, "queued-stop")).toMatchObject({ status: "cancelled", stopConfirmed: true });
    expect(await relay("read", target)).toMatchObject({ ended: true });
    expect(await createRuns(f.ports, f.workspaceId).claimNext("background")).toBeNull();

    const sinkHash = "context-sink-v1", sinkSource = join(f.ports.dataDir, "platform/store", sinkHash);
    await mkdir(sinkSource); await writeFile(join(sinkSource, "index.ts"), `import {on} from 'chrona';on('tool',async t=>({result:{caller:t.caller}}));`);
    const sinkManifest = moduleManifestSchema.parse({ name: "context-sink", entry: "index.ts", effects: [], tests: ["test.ts"], tools: [{ name: "observe", description: "Caller fixture", visibility: ["modules"], parameters: { type: "object", properties: {} }, output: {} }] });
    const sink = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "context-sink", status: "active", activeHash: sinkHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: sink.id, hash: sinkHash, source: "user", manifest: sinkManifest, status: "approved", intent: {}, report: {} } });
    expect(await relay("run", { ...input, tools: [{ moduleId: consumer.module.id, tool: "relay" }] }, "owner-escalation")).toMatchObject({ error: "forbidden" });
    const buildRequest = { name: "context-built", goal: "Verify original context admission", examples: [], intent: { changes: ["Add a deterministic fixture"], preserves: [] } };
    await expect(callSync(f.ports, consumer.origin, "modules.build", buildRequest)).rejects.toMatchObject({ code: "not_found" });
    const running = (await relay("run", { ...input, tools: [{ moduleId: sink.id, tool: "observe" }] }, "running")) as { runId: string };
    const runs = createRuns(f.ports, f.workspaceId), claimed = (await runs.claimNext("background"))!;
    expect(claimed.id).toBe(running.runId);
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, runId: claimed.id, token: claimed.token, cwd: claimed.cwd, lane: "background", deadline: claimed.deadlineAt });
    liveRuns.set(claimed.id, handle);
    const tools = createTools(f.ports), catalog = await tools.catalog(claimed.token);
    expect(catalog.map(tool => tool.name)).toEqual(["m_context_sink_observe"]);
    await expect(tools.call(claimed.token, "m_modules_build", buildRequest)).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.session.count({ where: { workspaceId: f.workspaceId, source: "build" } })).toBe(0);
    expect(await tools.call(claimed.token, "m_context_sink_observe", {})).toMatchObject({ result: { caller: { kind: "module", moduleId: consumer.module.id, hash: consumer.hash } } });
    await expect(tools.call(claimed.token, "chrona_preferences", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(tools.call(claimed.token, "m_context_consumer_relay", {})).rejects.toMatchObject({ code: "forbidden" });
    const activeTarget = { runId: running.runId };
    expect(await relay("run", input, "concurrent-running")).toMatchObject({ error: "conflict" });
    const write = { ...activeTarget, input: { kind: "message", text: "continue the explicit prompt" } };
    expect(await relay("write", write, "live-write")).toEqual({ accepted: true });
    expect(await relay("write", write, "live-write")).toEqual({ accepted: true });
    expect(await relay("write", { ...write, input: { kind: "message", text: "changed" } }, "live-write")).toMatchObject({ error: "conflict" });
    for (let i = 0; i < 2; i++) await f.ports.db.$transaction(tx => appendRunEventIn(tx, running.runId, "progress", { type: "progress", value: { phase: "working" } }, f.ports.now()));
    const logDir = join(claimed.cwd, ".chrona", "sessions");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, "fixture.jsonl"), [
      { type: "message", timestamp: "2026-11-07T00:00:00Z", message: { role: "user", content: "private user prompt" } },
      { type: "message", timestamp: "2026-11-07T00:00:01Z", message: { role: "assistant", content: [{ type: "thinking", text: "private reasoning" }, { type: "text", text: "Visible model reply" }] } },
    ].map(row => JSON.stringify(row)).join("\n"));
    const textPage = (await relay("read", activeTarget)) as Read;
    expect(textPage.transcript).toEqual([{ at: "2026-11-07T00:00:01Z", kind: "text", text: "Visible model reply" }]);
    for (const privateText of [f.ports.dataDir, "private reasoning", "private user prompt"]) expect(JSON.stringify(textPage)).not.toContain(privateText);
    let questionReady!: (id: string) => void;
    const ready = new Promise<string>(resolve => { questionReady = resolve; });
    const channel = createProviderChannel(f.ports, claimed, async request => { questionReady(request.id); });
    const question = channel.events.question({ method: "confirm", title: "Continue?", message: "Approve this step", options: [], timeoutMs: 5000 }, new AbortController().signal);
    const questionId = await ready;
    expect(await relay("read", activeTarget)).toMatchObject({ interactions: [{ id: questionId, status: "pending" }] });
    const answer = { ...activeTarget, input: { kind: "answer", questionId, answer: { decision: "submit", value: true } } };
    expect(await relay("write", answer, "confirm")).toEqual({ accepted: true });
    expect(await relay("write", answer, "confirm")).toEqual({ accepted: true });
    expect(await question).toEqual({ decision: "submit", value: true });
    expect(await relay("read", activeTarget)).toMatchObject({ interactions: [{ id: questionId, status: "answered" }] });
    await channel.close();
    const page = (await relay("read", { ...activeTarget, limit: 1 })) as Read;
    expect(page.items).toHaveLength(1); expect(page.items[0]!.sequence).toBe(1);
    expect(await relay("read", { ...activeTarget, cursor: page.nextCursor, limit: 1 })).toMatchObject({ items: [{ sequence: 2 }] });
    expect(await relay("read", { ...target, cursor: page.nextCursor })).toMatchObject({ error: "invalid" });
    expect(await relay("read", { ...activeTarget, view: "native", cursor: page.nextCursor })).toMatchObject({ error: "invalid" });
    await relay("stop", activeTarget, "live-stop");
    await runs.finish(claimed.id, await handle.done, { stopEvidence: "provider_exited" }); liveRuns.delete(claimed.id);
    expect(await relay("read", activeTarget)).toMatchObject({ run: { status: "cancelled", active: false }, ended: true });
    const next = (await relay("run", input, "after-stop")) as { runId: string };
    expect((await runs.claimNext("background"))!.id).toBe(next.runId);
    await runs.finish(next.runId, { outcome: "finished", sessionId: "continued-model-context", error: null }, { stopEvidence: "provider_exited" });
    expect(await f.ports.db.session.findUnique({ where: { id: first.contextId } })).toMatchObject({ status: "active", providerSessionId: "continued-model-context" });
    const failed = (await relay("run", input, "fail")) as { runId: string };
    expect((await runs.claimNext("background"))!.id).toBe(failed.runId);
    await runs.finish(failed.runId, { outcome: "failed", sessionId: null, error: "fixture failure" });
    expect(await relay("read", { runId: failed.runId })).toMatchObject({ run: { status: "unknown", active: true }, ended: false });
    await expect(assertExecutionModuleIdle(f.ports.db, consumer.module.id)).rejects.toThrow("停止待确认");
    expect(await relay("run", input, "unconfirmed-restart")).toMatchObject({ error: "conflict" });
    await runs.finish(failed.runId, { outcome: "failed", sessionId: null, error: "fixture failure" }, { stopEvidence: "provider_exited" });
    expect(await relay("read", { runId: failed.runId })).toMatchObject({ run: { status: "failed", active: false }, ended: true });
    await assertExecutionModuleIdle(f.ports.db, consumer.module.id);
    expect(await runs.claimNext("background")).toBeNull();
    expect(await f.ports.db.run.count({ where: { sessionId: first.contextId } })).toBe(4);
  } finally { liveRuns.clear(); await f.close(); }
}, 45000);

test("SDK completion uses public run/read with the original event budget and no content in ordinary audits", async () => {
  const f = await fixture();
  try {
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "cancelled", stopStatus: "confirmed" } });
    await f.ports.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { moduleModel: { maxCallsPerEvent: 1, maxOutputTokens: 100, dailyCalls: 10, eventTimeoutMs: 10000 } } } });
    await callSync(f.ports, owner(f), "pi.configure", { config: { model: "fake/fast" } });
    const source = `import {chrona,on} from 'chrona';on('tool',async event=>{
const args={providerId:'pi',kind:'completion',prompt:'private SDK prompt',providerOptions:{maxOutputTokens:100}};
const key=event.id+':'+event.firedAt;
const started=await chrona.call('agent.run',args,{key});
const replay=await chrona.call('agent.run',args,{key});
if(replay.runId!==started.runId)throw new Error('Run receipt changed');
let page;const deadline=Date.now()+10000;do{page=await chrona.call('agent.read',{runId:started.runId,waitMs:100});}while(!page.ended&&Date.now()<deadline);
if(!page.ended)throw new Error('completion remains unconfirmed');
let second;try{await chrona.call('agent.run',{...args,prompt:'second private SDK prompt'},{key:key+':second'});}catch(e){second={code:e.code,message:e.message};}
return {result:{first:page.items.find(item=>item.kind==='completion')?.payload,second}};});`;
    const consumer = await install(f, "sdk-model-consumer", source, ["exercise"]);
    const result = callSync(f.ports, owner(f), "sdk-model-consumer.exercise", {});
    void result.catch(() => {});
    const queued = await eventually(() => f.ports.db.run.findFirst({ where: { workspaceId: f.workspaceId, status: "queued" } }), value => !!value);
    const runs = createRuns(f.ports, f.workspaceId), claimed = (await runs.claimNext("background"))!;
    expect(claimed.id).toBe(queued!.id);
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, runId: claimed.id, token: claimed.token, cwd: claimed.cwd, lane: "background", deadline: claimed.deadlineAt });
    await runs.finish(claimed.id, await handle.done, { stopEvidence: "provider_exited" });
    expect((await result).output).toMatchObject({ first: { text: "fixture completion", inputTokens: 3, outputTokens: 4 }, second: { code: "failed", message: expect.stringContaining("budget_exceeded: module model call") } });
    const calls = await f.ports.db.moduleCall.findMany({ where: { method: "model" }, orderBy: { createdAt: "asc" } });
    // Failed admission rolls its reservation back; the original event cannot buy a second Run.
    expect(calls.map(row => [row.moduleId, row.hash, row.status])).toEqual([[consumer.module.id, consumer.hash, "executed"]]);
    expect(calls.every(row => row.moduleRunId && row.eventKey)).toBe(true);
    expect(await f.ports.db.run.count({ where: { session: { moduleId: consumer.module.id } } })).toBe(1);
    expect(await f.ports.db.providerLaunch.count()).toBe(1);
    const logs = JSON.stringify({ invocations: await f.ports.db.moduleInvocation.findMany({ where: { target: { in: ["agent", "pi", "runtime-callback"] } } }), audits: await f.ports.db.audit.findMany(), calls });
    for (const privateText of ["private SDK prompt", "fixture completion", claimed.token]) expect(logs).not.toContain(privateText);
  } finally { await f.close(); }
}, 30000);
