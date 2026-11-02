import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardRuntime, stewardDataDir } from "./steward-runtime";
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

test("runtime validates and wires execution mode and update review policy", async () => {
  const db = testDb(), keys = ["CHRONA_STEWARD_EXECUTION_MODE", "CHRONA_STEWARD_UPDATE_REVIEW", "CHRONA_STEWARD_AUTO_ROLLBACK"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    delete process.env.CHRONA_STEWARD_UPDATE_REVIEW;
    delete process.env.CHRONA_STEWARD_AUTO_ROLLBACK;
    const defaults = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-review-default-")), provider: null });
    try { expect(defaults.ports.moduleUpdateReview).toBe("required"); expect(defaults.ports.moduleAutoRollback).toBe(false); } finally { await defaults.stop(); }
    process.env.CHRONA_STEWARD_AUTO_ROLLBACK = "true";
    const enabled = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-rollback-enabled-")), provider: null });
    try { expect(enabled.ports.moduleAutoRollback).toBe(true); } finally { await enabled.stop(); }
    process.env.CHRONA_STEWARD_AUTO_ROLLBACK = "false";
    const disabled = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-rollback-disabled-")), provider: null });
    try { expect(disabled.ports.moduleAutoRollback).toBe(false); } finally { await disabled.stop(); }
    process.env.CHRONA_STEWARD_EXECUTION_MODE = "trusted-local";
    process.env.CHRONA_STEWARD_UPDATE_REVIEW = "checks-only";
    const runtime = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-review-mode-")), provider: null });
    try {
      expect(runtime.ports.sandbox?.executionMode).toBe("trusted-local");
      expect(runtime.ports.moduleUpdateReview).toBe("checks-only");
    } finally { await runtime.stop(); }
    process.env.CHRONA_STEWARD_UPDATE_REVIEW = "unexpected";
    expect(() => createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-review-invalid-")), provider: null })).toThrow("Invalid CHRONA_STEWARD_UPDATE_REVIEW");
    process.env.CHRONA_STEWARD_UPDATE_REVIEW = "required";
    process.env.CHRONA_STEWARD_AUTO_ROLLBACK = "unexpected";
    expect(() => createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-rollback-invalid-")), provider: null })).toThrow("Invalid CHRONA_STEWARD_AUTO_ROLLBACK");
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
