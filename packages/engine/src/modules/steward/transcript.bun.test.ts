import { expect, test } from "bun:test";
import { sessionTranscript } from "./transcript";
import type { ProviderAdapter } from "@chrona/contracts/steward";

test("history is optional and backend-independent; the kernel redacts before clipping", async () => {
  expect(await sessionTranscript({ dataDir: "/unused" }, "session")).toEqual([]);
  const secret = `sk-${"a".repeat(5000)}`;
  const provider: ProviderAdapter = { name: "other", health: async () => ({ available: true, sandboxed: false, error: null }), start: () => { throw new Error("unused"); }, transcript: async ({ limit }: { limit: number }) => {
    expect(limit).toBe(300);
    return [{ kind: "text" as const, at: "2026-11-07T04:00:00Z", text: secret }, { kind: "tool" as const, at: "", tool: "command", args: "token=credential-value" }];
  } };
  const output = await sessionTranscript({ dataDir: "/unused", provider }, "session", 1000);
  expect(JSON.stringify(output)).not.toContain("credential-value");
  expect(JSON.stringify(output)).not.toContain("a".repeat(12));
  expect(output[0]).toMatchObject({ kind: "text", text: "[Redacted]" });
});
