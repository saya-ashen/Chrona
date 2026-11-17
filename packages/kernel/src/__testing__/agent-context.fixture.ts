import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../host/src/runtime/script-sandbox";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testDb } from "./test-db";
import { testProviderPorts } from "./test-provider";
import type { StewardPorts } from "../ports";

export async function agentContextFixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-context-fixture-"));
  const db = testDb(), dataDir = join(root, "data");
  await mkdir(join(dataDir, "platform/store"), { recursive: true });
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: resolve(import.meta.dir, "../../../app-sdk") });
  const provider: ProviderAdapter = {
    name: "fixture-provider", supportsRunModel: true,
    async health() { return { available: true, sandboxed: false, error: null }; },
    start() {
      let settle!: (value: { outcome: "finished"; sessionId: null; error: null }) => void;
      return { done: new Promise(resolve => { settle = resolve; }), async inject() {}, async abort() { settle({ outcome: "finished", sessionId: null, error: null }); } };
    },
  };
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), provider, sandbox: { ...sandbox.health, ...sandbox } };
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  async function close() {
    try { await moduleSupervisor(ports).stop(); }
    finally { await db.$disconnect(); await rm(root, { recursive: true, force: true }); await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true }); }
  }
  try {
    await testProviderPorts(ports);
    const workspace = await db.workspace.create({ data: { name: "Context boundaries" } });
    const run = await db.run.create({ data: { workspaceId: workspace.id, lane: "foreground", trigger: "fixture", provider: provider.name, tokenHash: "fixture-token", cwd: root, prompt: "" } });
    return { root, ports, workspaceId: workspace.id, input: { runId: run.id, token: "fixture-token", lane: "foreground" as const, cwd: root, sessionDir: join(root, "sessions"), sessionId: null, prompt: "fixture", systemPrompt: "", resources: "minimal" as const, deadline: null }, close };
  } catch (error) { await close(); throw error; }
}
