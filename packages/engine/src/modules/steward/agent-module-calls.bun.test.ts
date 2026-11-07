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
