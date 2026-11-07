import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { piTranscript } from "./pi-transcript";

test("Pi normalizes session history, excludes user prompts/thinking, skips malformed lines and bounds item count", async () => {
  const sessionDir = await mkdtemp("/tmp/chrona-pi-transcript-test-");
  try {
    const entries = [
      { type: "session", id: "s" },
      { type: "message", message: { role: "user", content: "private prompt" } },
      { type: "message", timestamp: "2026-11-07T12:00:00Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "private thought" }, { type: "text", text: "检查测试" }, { type: "toolCall", name: "bash", arguments: { command: "bun test" } }] } },
      { type: "message", timestamp: "2026-11-07T12:00:01Z", message: { role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "failed" }, { type: "text", text: "reason" }] } },
    ];
    await writeFile(join(sessionDir, "session.jsonl"), entries.map(entry => JSON.stringify(entry)).join("\n") + "\nmalformed\nnull\n42\n");
    const result = await piTranscript({ sessionDir, limit: 20 });
    expect(result).toEqual([
      { at: "2026-11-07T12:00:00Z", kind: "text", text: "检查测试" },
      { at: "2026-11-07T12:00:00Z", kind: "tool", tool: "bash", args: '{"command":"bun test"}' },
      { at: "2026-11-07T12:00:01Z", kind: "result", tool: "bash", text: "failed\nreason", error: true },
    ]);
    expect(await piTranscript({ sessionDir, limit: 1 })).toEqual(result.slice(-1));
    expect(await piTranscript({ sessionDir: join(sessionDir, "missing"), limit: 20 })).toEqual([]);
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});
