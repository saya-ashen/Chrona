import { expect, test } from "bun:test";
import { sessionTranscript } from "./transcript";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";

test("history is optional and backend-independent; the kernel redacts before clipping", async () => {
  const db = testDb();
  const workspace = await db.workspace.create({ data: { name: "transcript" } });
  const session = await db.session.create({ data: { workspaceId: workspace.id, source: "web", key: "web:transcript" } });
  const ports: StewardPorts = { db, dataDir: "/unused", now: () => new Date(), publicUrl: null };
  expect(await sessionTranscript(ports, session.id)).toEqual([]);
  const secret = `sk-${"a".repeat(5000)}`;
  const provider: ProviderAdapter = { name: "other", health: async () => ({ available: true, sandboxed: false, error: null }), start: () => { throw new Error("unused"); }, transcript: async ({ limit }: { limit: number }) => {
    expect(limit).toBe(300);
    return [{ kind: "text" as const, at: "2026-11-07T04:00:00Z", text: secret }, { kind: "tool" as const, at: "", tool: "command", args: "token=credential-value" }];
  } };
  ports.provider = provider;
  const output = await sessionTranscript(ports, session.id, 1000);
  expect(JSON.stringify(output)).not.toContain("credential-value");
  expect(JSON.stringify(output)).not.toContain("a".repeat(12));
  expect(output[0]).toMatchObject({ kind: "text", text: "[Redacted]" });
  await db.$disconnect();
});
