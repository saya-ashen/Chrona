import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardRuntime } from "./steward-runtime";
import { sessionTranscript } from "../../../packages/engine/src/modules/steward/transcript";
import { stewardDataDir } from "../../../packages/integrations/src/steward/module-runtime";
test("E2E provider requires both the explicit test gate and provider selection", async () => {
  const db = testDb(), dataDir = mkdtempSync(join(tmpdir(), "chrona-e2e-gate-"));
  const previousGate = process.env.CHRONA_E2E_TEST_ROUTES, previousAgent = process.env.CHRONA_STEWARD_AGENT;
  try {
    for (const [gate, agent, expected] of [["0", "e2e", undefined], ["1", "none", undefined], ["1", "e2e", "e2e"]] as const) {
      process.env.CHRONA_E2E_TEST_ROUTES = gate;
      process.env.CHRONA_STEWARD_AGENT = agent;
      const runtime = createStewardRuntime(db, { dataDir, port: 48130 });
      expect(runtime.ports.provider?.name).toBe(expected);
      await runtime.stop();
    }
  } finally {
    if (previousGate === undefined) delete process.env.CHRONA_E2E_TEST_ROUTES;
    else process.env.CHRONA_E2E_TEST_ROUTES = previousGate;
    if (previousAgent === undefined) delete process.env.CHRONA_STEWARD_AGENT;
    else process.env.CHRONA_STEWARD_AGENT = previousAgent;
    await db.$disconnect();
  }
});

test("runtime forwards a dedicated Pi profile, executable and version pin", async () => {
  const db = testDb(), dataDir = mkdtempSync(join(tmpdir(), "chrona-pi-runtime-"));
  const command = join(dataDir, "fake-pi");
  writeFileSync(command, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nimport {join} from 'node:path';\nif(process.argv.includes('--version')){writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'probe.json'),JSON.stringify({agentDir:process.env.PI_CODING_AGENT_DIR}));console.log('0.85.0');process.exit(0)}\nprocess.exit(1);\n`, { mode: 0o755 });
  const keys = ["CHRONA_STEWARD_AGENT", "CHRONA_STEWARD_PI_COMMAND", "CHRONA_STEWARD_PI_AGENT_DIR", "CHRONA_STEWARD_PI_VERSION"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.CHRONA_STEWARD_AGENT = "pi"; process.env.CHRONA_STEWARD_PI_COMMAND = command;
    for (const custom of [false, true]) {
      const profile = join(dataDir, custom ? "explicit-profile" : "providers/pi"); mkdirSync(profile, { recursive: true, mode: 0o700 });
      if (custom) process.env.CHRONA_STEWARD_PI_AGENT_DIR = profile; else delete process.env.CHRONA_STEWARD_PI_AGENT_DIR;
      process.env.CHRONA_STEWARD_PI_VERSION = "0.85.0";
      const runtime = createStewardRuntime(db, { dataDir, port: 48130 });
      try {
        expect((await runtime.ports.provider!.health()).available).toBe(true);
        expect(JSON.parse(readFileSync(join(profile, "probe.json"), "utf8"))).toEqual({ agentDir: profile });
      } finally { await runtime.stop(); }
    }
    process.env.CHRONA_STEWARD_PI_VERSION = "1.3.0";
    const mismatch = createStewardRuntime(db, { dataDir, port: 48130 });
    try { expect((await mismatch.ports.provider!.health()).available).toBe(false); }
    finally { await mismatch.stop(); }
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    await db.$disconnect();
  }
});

test("runtime preserves routed Provider history through the lifecycle wrapper", async () => {
  const db = testDb(), dataDir = mkdtempSync(join(tmpdir(), "chrona-runtime-history-"));
  let selected: { sessionDir: string; limit: number } | undefined;
  const runtime = createStewardRuntime(db, { dataDir, provider: {
    name: "history-fixture", health: async () => ({ available: true, sandboxed: false, error: null }),
    start() { throw new Error("History does not start a model"); },
    async transcript(input) { selected = input; return [{ kind: "text", at: "2026-11-07T00:00:00.000Z", text: "Retained conversation" }]; },
  } });
  try {
    const workspace = await db.workspace.create({ data: { name: "History" } });
    const session = await db.session.create({ data: { workspaceId: workspace.id, source: "web", key: "web:history" } });
    expect(await sessionTranscript(runtime.ports, session.id, 10)).toEqual([{ kind: "text", at: "2026-11-07T00:00:00.000Z", text: "Retained conversation" }]);
    expect(selected).toEqual({ sessionDir: join(dataDir, "sessions", session.id, ".chrona/sessions"), limit: 10 });
    const invocation = await db.moduleInvocation.findFirstOrThrow({ where: { workspaceId: workspace.id, target: "agent", tool: "transcript" } });
    expect(invocation.status).toBe("succeeded");
    expect(JSON.stringify(invocation)).not.toContain("Retained conversation");
  } finally { await runtime.stop(); await db.$disconnect(); }
});

test("runtime wires default and explicit execution mode", async () => {
  const db = testDb(), keys = ["CHRONA_STEWARD_EXECUTION_MODE"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    delete process.env.CHRONA_STEWARD_EXECUTION_MODE;
    const defaults = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-review-default-")), provider: null });
    try {
      expect(defaults.ports.sandbox?.executionMode).toBe("trusted-local");
    } finally { await defaults.stop(); }
    process.env.CHRONA_STEWARD_EXECUTION_MODE = "trusted-local";
    const runtime = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-review-mode-")), provider: null });
    try {
      expect(runtime.ports.sandbox?.executionMode).toBe("trusted-local");
    } finally { await runtime.stop(); }
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    await db.$disconnect();
  }
});

test("unknown execution mode fails closed", async () => {
  const db = testDb(), previous = process.env.CHRONA_STEWARD_EXECUTION_MODE;
  try {
    process.env.CHRONA_STEWARD_EXECUTION_MODE = "unexpected";
    expect(() => createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-mode-invalid-")), provider: null })).toThrow("Invalid CHRONA_STEWARD_EXECUTION_MODE");
  } finally {
    if (previous === undefined) delete process.env.CHRONA_STEWARD_EXECUTION_MODE; else process.env.CHRONA_STEWARD_EXECUTION_MODE = previous;
    await db.$disconnect();
  }
});

test("runtime forwards thrown and stage failures to onError", async () => {
  const db = testDb(), errors: unknown[] = [], error = new TypeError("approval failed");
  const runtime = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-runtime-error-")), provider: null, onError: value => { errors.push(value); } });
  const tick = spyOn(runtime.service, "tick");
  try {
    tick.mockRejectedValueOnce(error);
    await runtime.tickOnce();
    tick.mockResolvedValueOnce({ failures: [{ workspaceId: "w", stage: "modules", error }] });
    await runtime.tickOnce();
    expect(errors).toEqual([error, error]);
  } finally { tick.mockRestore(); await runtime.stop(); await db.$disconnect(); }
});

test("shutdown waits for background finalization before closing modules and returning", async () => {
  const db = testDb();
  const runtime = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-shutdown-")), provider: null });
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const settled = spyOn(runtime.service.tick, "settled").mockImplementation(async () => { entered(); await pending; });
  let stopped = false;
  const stopping = runtime.stop().then(() => { stopped = true; });
  try {
    await started;
    expect(stopped).toBe(false);
    release(); await stopping;
    expect(stopped).toBe(true);
    expect(settled).toHaveBeenCalledTimes(2);
  } finally { release(); await stopping; settled.mockRestore(); await db.$disconnect(); }
});

test("runtime clears persisted executor authority before requests and propagates startup failure", async () => {
  const db = testDb(), dataDir = mkdtempSync(join(tmpdir(), "chrona-executor-startup-"));
  try {
    await db.workspace.create({ data: { id: "ws_default", name: "Owner" } });
    await db.executionExecutor.create({ data: { id: "startup-device", workspaceId: "ws_default", ownerId: "owner", label: "Startup", credentialHash: "startup-hash", incarnation: "retained", reconciledAt: new Date(), authorizedUntil: new Date(Date.now() + 60000) } });
    const runtime = createStewardRuntime(db, { dataDir, provider: null });
    await runtime.initialize();
    expect(await db.executionExecutor.findUniqueOrThrow({ where: { id: "startup-device" } })).toMatchObject({ incarnation: "retained", authorizedUntil: null, reconciledAt: null });
    await db.executionExecutor.update({ where: { id: "startup-device" }, data: { reconciledAt: new Date() } });
    await runtime.initialize();
    expect((await db.executionExecutor.findUniqueOrThrow({ where: { id: "startup-device" } })).reconciledAt).not.toBeNull();
    const failed = createStewardRuntime(db, { dataDir, provider: null });
    await db.$executeRawUnsafe('CREATE TRIGGER "fail_executor_startup" BEFORE UPDATE ON "ExecutionExecutor" BEGIN SELECT RAISE(ABORT, \'startup unavailable\'); END');
    await expect(failed.initialize()).rejects.toThrow();
    await db.$executeRawUnsafe('DROP TRIGGER "fail_executor_startup"');
  } finally { await db.$disconnect(); }
});

test("runtime data directory follows explicit setting then database directory", () => {
  expect(stewardDataDir({ CHRONA_DATA_DIR: "/tmp/chrona-data", DATABASE_URL: "file:/tmp/db/test.db" })).toBe("/tmp/chrona-data");
  expect(stewardDataDir({ DATABASE_URL: "file:/tmp/db/test.db" })).toBe("/tmp/db");
  expect(() => stewardDataDir({ DATABASE_URL: "file::memory:" })).toThrow();
});
// Fresh runtime bootstraps and builds built-ins, so this startup test needs more than Bun's 5-second default.
test("runtime ticks every 30 seconds, wakes immediately and stops cleanly", async () => {
  const db = testDb();
  let interval = 0, cleared = false;
  const runtime = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-v4b-runtime-")), provider: null,
    timers: { setInterval: ((_fn: () => void, ms: number) => { interval = ms; return 1; }) as unknown as typeof setInterval, clearInterval: (() => { cleared = true; }) as typeof clearInterval },
  });
  try {
    await db.workspace.create({ data: { id: "w", name: "Test" } });
    runtime.start(); await runtime.tickOnce();
    expect(interval).toBe(30000);
    expect((await db.stewardState.findUniqueOrThrow({ where: { workspaceId: "w" } })).lastTickAt).not.toBeNull();
    expect((await runtime.health()).provider.available).toBe(false);
    expect((await runtime.health()).moduleSandbox).toBe(false);
    await runtime.stop(); expect(cleared).toBe(true);
  } finally { await runtime.stop(); await db.$disconnect(); }
}, 30_000);
