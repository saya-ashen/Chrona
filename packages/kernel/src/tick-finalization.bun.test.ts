import { testProviderPorts } from "./test-provider";
import { expect, spyOn, test } from "bun:test";
import "./modules/module-effects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { callSync, kernelOrigin } from "./modules/module-calls";
import { moduleSupervisor } from "./modules/module-supervisor";
import { testModuleSandbox } from "./modules/module-test-process";
import { liveRuns } from "./execution/runs";
import { testDb } from "./test-db";
import { createTick } from "./tick";
import type { StewardPorts } from "./ports";

type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
test.each([
  { name: "finished", outcome: "finished", error: null, cancel: false, reject: false },
  { name: "failed", outcome: "failed", error: "Original Provider error", cancel: false, reject: false },
  { name: "cancelled during finalization retry", outcome: "finished", error: null, cancel: true, reject: false },
  { name: "rejected completion keeps stop unknown", outcome: "failed", error: null, cancel: false, reject: true },
] as const)("unlimited Run retries failed finish transaction: $name", async item => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-tick-finalization-"));
  let time = new Date("2026-11-01T05:00:00Z");
  const starts: ProviderRunInput[] = [], finished: string[] = [];
  const completion = Promise.withResolvers<Outcome>();
  const ports: StewardPorts = { db, dataDir, now: () => time, publicUrl: null,
    moduleSdk: fileURLToPath(new URL("../../app-sdk", import.meta.url)),
    moduleTypecheck: fileURLToPath(new URL("../../app-sdk/typecheck", import.meta.url)),
    sandbox: testModuleSandbox(async () => ({ status: "succeeded", output: "{}", error: null, exitCode: 0 })),
    onRunFinished: async (_, runId) => { finished.push(runId); },
    provider: { name: "fixture", async health() { return { available: true, sandboxed: true, error: null }; }, start(input) {
      starts.push(input);
      return { done: completion.promise, async inject() {}, async abort() {} };
    } } };
  await testProviderPorts(ports);
  const tick = createTick(ports);
  const errors = spyOn(console, "error").mockImplementation(() => {});
  let runId: string | undefined;
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "finalization" } })).id;
    const module = await db.module.create({ data: { workspaceId, name: "fixture-app", activeHash: "hash", status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", manifest: { name: "fixture-app", entry: "index.ts", keepAlive: true, effects: [], uses: ["agent.run", "agent.read"], tests: ["test.ts"] }, status: "approved", source: "user", intent: {}, report: {} } });
    const origin = { ...kernelOrigin(workspaceId), caller: { kind: "module" as const, module: module.name, moduleId: module.id, hash: "hash" } };
    const run = (await callSync(ports, origin, "agent.run", { prompt: "Work once" }, { key: "run" })).output as { runId: string; contextId: string };
    runId = run.runId;
    expect((await tick()).failures).toEqual([]);
    await tick.settled();
    expect(starts).toHaveLength(1);
    expect(starts[0]!.deadline).toBeNull();
    expect(await db.run.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: "running", deadlineAt: null, leaseUntil: null });

    // Fail inside finish's real transaction; its status/session writes must roll back.
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_run_finish BEFORE UPDATE OF status ON "Run"
      WHEN NEW."endedAt" IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected finish failure'); END`);
    if (item.reject) completion.reject(new Error("Completion transport failed"));
    else completion.resolve({ outcome: item.outcome, sessionId: "original-provider-session", error: item.error });
    await tick.settled({ includeRuns: true });
    expect(await db.audit.count({ where: { kind: "run_finalize_failed", subjectId: runId } })).toBe(1);
    const diagnostics = errors.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(diagnostics).toContainEqual(expect.objectContaining({ component: "tick", event: "run_finalize_failed", runId, error: expect.stringContaining("Foreign key constraint violated") }));
    if (item.reject) expect(diagnostics).toContainEqual(expect.objectContaining({ event: "provider_completion.failed", runId, error: expect.stringContaining("Provider completion requires reconciliation") }));
    expect(await db.audit.count({ where: { kind: "run_finished", subjectId: runId } })).toBe(0);
    expect(await db.run.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: "running", endedAt: null });
    expect((await db.session.findUniqueOrThrow({ where: { id: run.contextId } })).providerSessionId).toBeNull();
    expect(finished).toEqual([]);
    await db.$executeRawUnsafe("DROP TRIGGER fail_run_finish");

    // Cancellation can be persisted while the Provider's exit awaits finalization.
    if (item.cancel) await db.run.update({ where: { id: runId }, data: { cancelRequestedAt: ports.now() } });
    time = new Date(time.getTime() + 86400_000);
    expect((await tick()).failures).toEqual([]);
    await tick.settled({ includeRuns: true });
    const status = item.cancel ? "cancelled" : item.outcome;
    expect(await db.run.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status, stopStatus: item.reject ? "unknown" : "confirmed", error: item.reject ? "Execution stop is unconfirmed" : item.cancel ? "Cancelled by owner" : item.error, endedAt: time });
    expect((await db.session.findUniqueOrThrow({ where: { id: run.contextId } })).providerSessionId).toBe(item.reject ? null : "original-provider-session");
    expect((await callSync(ports, origin, "agent.read", { runId })).output).toMatchObject({ run: { status: item.reject ? "unknown" : status, active: item.reject } });
    expect(finished).toEqual([runId]);
    expect(await db.audit.count({ where: { kind: "run_finished", subjectId: runId } })).toBe(1);
    expect((await tick()).failures).toEqual([]);
    await tick.settled({ includeRuns: true });
    expect(starts).toHaveLength(1);
    expect(await db.run.count({ where: { workspaceId } })).toBe(1);
    expect(finished).toEqual([runId]);
  } finally {
    completion.resolve({ outcome: "failed", sessionId: null, error: "Fixture cleanup" });
    await tick.settled({ includeRuns: true });
    if (runId) liveRuns.delete(runId);
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true });
    errors.mockRestore();
  }
});
