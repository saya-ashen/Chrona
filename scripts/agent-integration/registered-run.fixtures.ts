import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type ProviderInteraction } from "@chrona/contracts/steward";
import { agentFixture } from "./agent-application.fixtures";
import { callSync, kernelOrigin } from "../../packages/engine/src/modules/steward/module-calls";
import { createRuns, liveRuns } from "../../packages/engine/src/modules/steward/runs";
import { createProviderChannel } from "../../packages/engine/src/modules/steward/provider-channel";
import { startLocalProvider } from "../../packages/engine/src/modules/steward/local-runtime";

/** An approved application uses public Agent tools; Pi itself is registered by its real SDK. */
export async function registeredRunFixture(prompt = "Offline acceptance prompt", onInteraction?: (request: ProviderInteraction) => Promise<void>) {
  const f = await agentFixture();
  try {
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "cancelled", stopStatus: "confirmed" } });
    async function caller(name: string) {
      const row = await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name, activeHash: "caller-v1", status: "active" } });
      const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], tools: [{ name: "noop", description: "Acceptance fixture tool", parameters: { type: "object", properties: {}, required: [] }, output: { type: "null" } }], effects: [], uses: ["agent.providers", "agent.run", "agent.read", "agent.write", "agent.stop", "agent.native"] });
      await f.ports.db.moduleVersion.create({ data: { moduleId: row.id, hash: row.activeHash!, manifest, source: "user", status: "approved", intent: {}, report: {} } });
      return { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: name, moduleId: row.id, hash: row.activeHash! } };
    }
    const origin = await caller("acceptance-caller");
    const call = async <T = Record<string, unknown>>(tool: string, args: unknown, key?: string, who = origin): Promise<T> =>
      (await callSync(f.ports, who, `agent.${tool}`, args, { ...(key ? { key } : {}) })).output as T;
    const input = { providerId: "pi", prompt, lane: "foreground", tools: [], providerOptions: {} };
    const admitted = await call<{ runId: string; contextId: string; status: string }>("run", input, "start");
    let channel: ReturnType<typeof createProviderChannel> | undefined;
    let handle: Awaited<ReturnType<typeof startLocalProvider>> | undefined;
    let settled = false;
    let finished: Promise<unknown> | undefined;
    async function launch() {
      const run = await createRuns(f.ports, f.workspaceId).claimNext("foreground");
      if (!run || run.id !== admitted.runId) throw new Error("Public admitted Run was not claimed");
      await mkdir(run.cwd, { recursive: true });
      channel = createProviderChannel(f.ports, run, onInteraction);
      handle = await startLocalProvider(f.ports, f.workspaceId, { runId: run.id, token: run.token, lane: "foreground", cwd: run.cwd, sessionDir: join(run.cwd, ".chrona/sessions"), sessionId: null, prompt, systemPrompt: "", resources: "minimal", deadline: run.deadlineAt, events: channel.events });
      liveRuns.set(run.id, handle);
      // Drive the normal queue consumer's terminal receipt with actual Provider stop evidence.
      finished = handle.done.then(outcome => createRuns(f.ports, f.workspaceId).finish(run.id, outcome, { stopEvidence: "provider_exited" }));
      void finished.finally(() => { settled = true; liveRuns.delete(run.id); }).catch(() => {});
      return { run, handle, channel };
    }
    return { ...f, caller, origin, call, input, admitted, launch, async close() {
      try { if (handle && !settled) { await handle.abort(); await finished; } }
      finally { liveRuns.delete(admitted.runId); await channel?.close(); await f.close(); }
    } };
  } catch (error) { await f.close(); throw error; }
}

export async function eventually<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 4000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() >= until) throw new Error(`Acceptance observation timed out: ${JSON.stringify(value)}`);
    await Bun.sleep(20);
  }
}
