import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sessionTranscript } from "./transcript";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { testProviderPorts } from "./test-provider";
import { createRuns } from "./runs";
import { moduleSupervisor } from "./module-supervisor";

test("history follows the Run's registered provider; the kernel redacts before clipping", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-transcript-");
  const files = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null };
  try {
    const workspace = await db.workspace.create({ data: { name: "transcript" } });
    const session = await db.session.create({ data: { workspaceId: workspace.id, source: "web", key: "web:transcript" } });
    expect(await sessionTranscript(ports, session.id)).toEqual([]);
    const provider: ProviderAdapter = { name: "other", health: async () => ({ available: true, sandboxed: false, error: null }), start: () => { throw new Error("Transcript must not start a model"); } };
    ports.provider = provider;
    await testProviderPorts(ports);
    expect(await sessionTranscript(ports, session.id)).toEqual([]);
    const run = await createRuns(ports, workspace.id).enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "history" });
    expect(await db.agentRunProvider.findUniqueOrThrow({ where: { runId: run.id } })).toMatchObject({ providerId: "other" });
    // A registered provider may return no history, without starting a conversation.
    expect(await sessionTranscript(ports, session.id)).toEqual([]);
    const secret = `sk-${"a".repeat(5000)}`;
    let reads = 0;
    provider.transcript = async ({ sessionDir, limit }) => {
      reads++;
      expect(sessionDir).toBe(join(run.cwd, ".chrona", "sessions"));
      expect(limit).toBe(300);
      return [{ kind: "text", at: "2026-11-07T04:00:00Z", text: secret }, { kind: "tool", at: "", tool: "command", args: "token=credential-value" }];
    };
    const output = await sessionTranscript(ports, session.id, 1000);
    expect(reads).toBe(1);
    expect(JSON.stringify(output)).not.toContain("credential-value");
    expect(JSON.stringify(output)).not.toContain("a".repeat(12));
    expect(output[0]).toMatchObject({ kind: "text", text: "[Redacted]" });
    const records = await db.moduleInvocation.findMany({ where: { target: "test-provider", tool: "transcript" } });
    expect(records).toHaveLength(2);
    expect(records.every(row => JSON.stringify(row.args) === "{}" && row.output === null)).toBe(true);
    expect(JSON.stringify(records)).not.toContain("credential-value");
    expect(JSON.stringify(records)).not.toContain(secret);
  } finally {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true });
    await rm(dirname(files.find(row => row.name === "main")!.file), { recursive: true, force: true });
  }
});
