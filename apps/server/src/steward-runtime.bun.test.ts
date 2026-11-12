import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardRuntime } from "./steward-runtime";
import { stewardDataDir } from "../../../packages/integrations/src/steward/module-runtime";
test("released runtime never selects a test Provider from environment flags", async () => {
  const db = testDb({ injectedAgent: false }), dataDir = mkdtempSync(join(tmpdir(), "chrona-e2e-gate-"));
  const previousGate = process.env.CHRONA_E2E_TEST_ROUTES, previousAgent = process.env.CHRONA_STEWARD_AGENT;
  try {
    for (const [gate, agent] of [["0", "e2e"], ["1", "none"], ["1", "e2e"]] as const) {
      process.env.CHRONA_E2E_TEST_ROUTES = gate;
      process.env.CHRONA_STEWARD_AGENT = agent;
      const runtime = createStewardRuntime(db, { dataDir, port: 48130 });
      expect(runtime.ports.provider?.name).toBe("registered");
      expect((await runtime.health()).provider.available).toBe(false);
      expect(await db.module.count()).toBe(0);
      expect(runtime.ports.moduleBuiltinResources).toBeUndefined();
      await runtime.stop();
    }
  } finally {
    if (previousGate === undefined) delete process.env.CHRONA_E2E_TEST_ROUTES;
    else process.env.CHRONA_E2E_TEST_ROUTES = previousGate;
    if (previousAgent === undefined) delete process.env.CHRONA_STEWARD_AGENT;
    else process.env.CHRONA_STEWARD_AGENT = previousAgent;
    await db.$disconnect();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("runtime configures optional Pi without launching it or forcing a private profile", async () => {
  const db = testDb({ injectedAgent: false }), dataDir = mkdtempSync(join(tmpdir(), "chrona-pi-runtime-"));
  const command = join(dataDir, "fake-pi");
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
        expect(runtime.ports.provider?.name).toBe("registered");
        expect(JSON.parse(runtime.ports.providerModules!.pi!.env.CHRONA_PROVIDER_CONFIGURATION)).toMatchObject({ command, ...(custom ? { agentDir: profile } : {}), expectedVersion: "0.85.0", agentUrl: "http://127.0.0.1:48130/api/steward-agent" });
        if (!custom) expect(JSON.parse(runtime.ports.providerModules!.pi!.env.CHRONA_PROVIDER_CONFIGURATION).agentDir).toBeUndefined();
        expect(await db.module.count()).toBe(0);
      } finally { await runtime.stop(); }
    }
    process.env.CHRONA_STEWARD_PI_VERSION = "1.3.0";
    const mismatch = createStewardRuntime(db, { dataDir, port: 48130 });
    try { expect(JSON.parse(mismatch.ports.providerModules!.pi!.env.CHRONA_PROVIDER_CONFIGURATION).expectedVersion).toBe("1.3.0"); }
    finally { await mismatch.stop(); }
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    await db.$disconnect();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("trusted host injection preserves Provider history through the lifecycle wrapper", async () => {
  const db = testDb({ injectedAgent: false }), dataDir = mkdtempSync(join(tmpdir(), "chrona-runtime-history-"));
  let selected: { sessionDir: string; limit: number } | undefined;
  const runtime = createStewardRuntime(db, { dataDir, provider: {
    name: "history-fixture", health: async () => ({ available: true, sandboxed: false, error: null }),
    start() { throw new Error("History does not start a model"); },
    async transcript(input) { selected = input; return [{ kind: "text", at: "2026-11-07T00:00:00.000Z", text: "Retained conversation" }]; },
  } });
  try {
    const input = { sessionDir: join(dataDir, "sessions", "fixture", ".chrona/sessions"), limit: 10 };
    expect(await runtime.ports.provider!.transcript!(input)).toEqual([{ kind: "text", at: "2026-11-07T00:00:00.000Z", text: "Retained conversation" }]);
    expect(selected).toEqual(input);
    expect(runtime.ports.providerModules).toBeUndefined();
    expect(await db.module.count()).toBe(0);
  } finally { await runtime.stop(); await db.$disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
});

test("runtime wires default and explicit execution mode", async () => {
  const db = testDb({ injectedAgent: false }), keys = ["CHRONA_STEWARD_EXECUTION_MODE"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    delete process.env.CHRONA_STEWARD_EXECUTION_MODE;
    const dataDir = mkdtempSync(join(tmpdir(), "chrona-review-default-"));
    const defaults = createStewardRuntime(db, { dataDir, provider: null });
    try {
      expect(defaults.ports.sandbox?.executionMode).toBe("trusted-local");
    } finally { await defaults.stop(); rmSync(dataDir, { recursive: true, force: true }); }
    process.env.CHRONA_STEWARD_EXECUTION_MODE = "trusted-local";
    const modeDataDir = mkdtempSync(join(tmpdir(), "chrona-review-mode-"));
    const runtime = createStewardRuntime(db, { dataDir: modeDataDir, provider: null });
    try {
      expect(runtime.ports.sandbox?.executionMode).toBe("trusted-local");
    } finally { await runtime.stop(); rmSync(modeDataDir, { recursive: true, force: true }); }
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    await db.$disconnect();
  }
});

test("unknown execution mode fails closed", async () => {
  const db = testDb({ injectedAgent: false }), previous = process.env.CHRONA_STEWARD_EXECUTION_MODE;
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-mode-invalid-"));
  try {
    process.env.CHRONA_STEWARD_EXECUTION_MODE = "unexpected";
    expect(() => createStewardRuntime(db, { dataDir, provider: null })).toThrow("CHRONA_STEWARD_EXECUTION_MODE supports only trusted-local");
  } finally {
    if (previous === undefined) delete process.env.CHRONA_STEWARD_EXECUTION_MODE; else process.env.CHRONA_STEWARD_EXECUTION_MODE = previous;
    await db.$disconnect();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("runtime forwards thrown and stage failures to onError", async () => {
  const db = testDb({ injectedAgent: false }), errors: unknown[] = [], error = new TypeError("approval failed");
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-runtime-error-"));
  const runtime = createStewardRuntime(db, { dataDir, provider: null, onError: value => { errors.push(value); } });
  const tick = spyOn(runtime.service, "tick");
  try {
    tick.mockRejectedValueOnce(error);
    await runtime.tickOnce();
    tick.mockResolvedValueOnce({ failures: [{ workspaceId: "w", stage: "modules", error }] });
    await runtime.tickOnce();
    expect(errors).toEqual([error, error]);
  } finally { tick.mockRestore(); await runtime.stop(); await db.$disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
});

test("shutdown waits for background finalization before closing modules and returning", async () => {
  const db = testDb({ injectedAgent: false });
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-shutdown-"));
  const runtime = createStewardRuntime(db, { dataDir, provider: null });
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
  } finally { release(); await stopping; settled.mockRestore(); await db.$disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
});

test("runtime data directory follows explicit setting then database directory", () => {
  expect(stewardDataDir({ CHRONA_DATA_DIR: "/tmp/chrona-data", DATABASE_URL: "file:/tmp/db/test.db" })).toBe("/tmp/chrona-data");
  expect(stewardDataDir({ DATABASE_URL: "file:/tmp/db/test.db" })).toBe("/tmp/db");
  expect(() => stewardDataDir({ DATABASE_URL: "file::memory:" })).toThrow();
});
// Fresh runtime initializes ordinary preinstall receipts; no builtin application is seeded.
test("runtime ticks every 30 seconds, wakes immediately and stops cleanly", async () => {
  const db = testDb({ injectedAgent: false });
  let interval = 0, cleared = false;
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-v4b-runtime-"));
  const runtime = createStewardRuntime(db, { dataDir, provider: null,
    timers: { setInterval: ((_fn: () => void, ms: number) => { interval = ms; return 1; }) as unknown as typeof setInterval, clearInterval: (() => { cleared = true; }) as typeof clearInterval },
  });
  try {
    runtime.ports.moduleExternalResources = join(runtime.ports.dataDir, "missing-external-fixture");
    await db.workspace.create({ data: { id: "w", name: "Test" } });
    runtime.start(); await runtime.tickOnce();
    expect(interval).toBe(30000);
    expect((await db.stewardState.findUniqueOrThrow({ where: { workspaceId: "w" } })).lastTickAt).not.toBeNull();
    expect((await runtime.health()).provider.available).toBe(false);
    expect((await runtime.health()).moduleSandbox).toBe(false);
    await runtime.stop(); expect(cleared).toBe(true);
  } finally { await runtime.stop(); await db.$disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
}, 30_000);
