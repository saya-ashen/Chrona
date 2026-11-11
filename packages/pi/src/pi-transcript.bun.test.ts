import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rename, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleEventReplySchema, type ProviderTranscriptItem } from "@chrona/contracts/steward";
import { piTranscript, piTranscriptPage, PI_TRANSCRIPT_MAX_BYTES, type PiTranscriptGap } from "./pi-transcript";

const assistant = (content: unknown) => JSON.stringify({ type: "message", timestamp: "2026-11-07T12:00:00Z", message: { role: "assistant", content } }) + "\n";
async function pages(sessionDir: string, limit = 300) {
  const items: ProviderTranscriptItem[] = [], gaps: PiTranscriptGap[] = [];
  let cursor: string | undefined, count = 0;
  do {
    const page = await piTranscriptPage({ sessionDir, limit, cursor });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(PI_TRANSCRIPT_MAX_BYTES);
    expect(moduleEventReplySchema.safeParse({ id: "page", result: { result: page } }).success).toBe(true);
    expect(page.nextCursor).not.toBe(cursor);
    items.push(...page.items); gaps.push(...page.gaps);
    cursor = page.nextCursor ?? undefined;
    if (++count > 100) throw new Error("Pagination did not advance");
  } while (cursor);
  return { items, gaps, count };
}

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

test("Pi pages oversized UTF-8 transcript without splitting, losing or duplicating items in a single record", async () => {
  const sessionDir = await mkdtemp("/tmp/chrona-pi-pages-");
  try {
    const blocks = Array.from({ length: 90 }, (_, i) => ({ type: "text", text: `${i}:检查🙂\\"` + "多字节".repeat(500) }));
    await writeFile(join(sessionDir, "session.jsonl"), assistant(blocks));
    const expected = blocks.map(block => ({ at: "2026-11-07T12:00:00Z", kind: "text" as const, text: block.text }));
    expect(Buffer.byteLength(JSON.stringify(expected))).toBeGreaterThan(262144);
    const tail = await piTranscript({ sessionDir, limit: 300 });
    expect(tail[0]).toMatchObject({ kind: "text", text: expect.stringContaining("[Pi transcript gap]") });
    expect(tail.length).toBeGreaterThan(1);
    expect(tail.slice(1)).toEqual(expected.slice(-(tail.length - 1)));
    expect(Buffer.byteLength(JSON.stringify(tail))).toBeLessThanOrEqual(PI_TRANSCRIPT_MAX_BYTES);
    expect(moduleEventReplySchema.safeParse({ id: "tail", result: { result: tail } }).success).toBe(true);
    const result = await pages(sessionDir);
    expect(result.items).toEqual(expected); expect(result.gaps).toEqual([]); expect(result.count).toBeGreaterThan(1);
    expect(await piTranscript({ sessionDir, limit: 1 })).toEqual(expected.slice(-1));
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});

test("Pi pages cross sorted files, bound ignored input, and report oversized item/record gaps with forward progress", async () => {
  const sessionDir = await mkdtemp("/tmp/chrona-pi-gaps-");
  try {
    await mkdir(join(sessionDir, "nested"));
    const file = "a.jsonl";
    const hugeItem = assistant([{ type: "text", text: "大".repeat(80000) }, { type: "text", text: "after item" }]);
    // The long source record spans read windows, including a multibyte boundary.
    const hugeRecord = assistant([{ type: "text", text: "🙂".repeat(600000) }]);
    await writeFile(join(sessionDir, file), hugeItem + hugeRecord + assistant("after record"));
    await writeFile(join(sessionDir, "nested", "b.jsonl"), assistant("last file"));
    const tail = await piTranscript({ sessionDir, limit: 3 });
    expect(tail[0]).toMatchObject({ kind: "text", text: expect.stringContaining("Earlier source content was not inspected") });
    expect(tail.slice(1).map(item => item.kind === "text" ? item.text : "unexpected")).toEqual(["after record", "last file"]);
    const result = await pages(sessionDir, 2);
    expect(result.items.map(item => item.kind === "text" ? item.text : "unexpected")).toEqual(["after item", "after record", "last file"]);
    expect(result.gaps[0]).toMatchObject({ file, offset: 0, reason: "item_too_large", item: 0 });
    const recordGaps = result.gaps.filter(gap => gap.reason === "record_too_large");
    expect(recordGaps.length).toBeGreaterThan(1);
    expect(recordGaps[0].offset).toBe(Buffer.byteLength(hugeItem));
    expect(recordGaps.reduce((bytes, gap) => bytes + gap.bytes, 0)).toBe(Buffer.byteLength(hugeRecord));
    // An oversized final unterminated record must finish rather than repeat an EOF cursor.
    await writeFile(join(sessionDir, "z.jsonl"), hugeRecord.trimEnd());
    expect((await pages(sessionDir)).items).toEqual(result.items);
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});

test("Pi cursors allow append, reject malformed/foreign/replaced/truncated files, and resume within a record", async () => {
  const sessionDir = await mkdtemp("/tmp/chrona-pi-cursor-");
  try {
    const path = join(sessionDir, "a.jsonl");
    await writeFile(path, assistant([{ type: "text", text: "first" }, { type: "text", text: "second" }]));
    const first = await piTranscriptPage({ sessionDir, limit: 1 });
    expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
    await appendFile(path, assistant("appended"));
    const rest = await piTranscriptPage({ sessionDir, limit: 20, cursor: first.nextCursor! });
    expect(rest.items.map(item => item.kind === "text" && item.text)).toEqual(["second", "appended"]);
    for (const cursor of ["not-json", Buffer.from(JSON.stringify({ v: 1, file: "../private.jsonl", identity: "0:0", offset: 0, size: 0, item: 0, skip: false })).toString("base64url")]) {
      await expect(piTranscriptPage({ sessionDir, limit: 1, cursor })).rejects.toHaveProperty("code");
    }
    await truncate(path, 10);
    await expect(piTranscriptPage({ sessionDir, limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "cursor_expired" });
    await rename(path, path + ".old"); await writeFile(path, assistant("replacement"));
    await expect(piTranscriptPage({ sessionDir, limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "cursor_expired" });
    expect(await piTranscriptPage({ sessionDir: join(sessionDir, "missing"), limit: 1 })).toEqual({ items: [], nextCursor: null, gaps: [] });
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});

test("Pi measures serialized UTF-8 bytes including escapes and fits complete items near the page boundary", async () => {
  const sessionDir = await mkdtemp("/tmp/chrona-pi-byte-boundary-");
  try {
    const path = join(sessionDir, "a.jsonl"), text = "字".repeat(Math.floor((PI_TRANSCRIPT_MAX_BYTES - 200) / 3));
    await writeFile(path, assistant(text));
    const page = await piTranscriptPage({ sessionDir, limit: 300 });
    expect(page.items).toEqual([{ at: "2026-11-07T12:00:00Z", kind: "text", text }]);
    expect(page.gaps).toEqual([]); expect(page.nextCursor).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(page))).toBeGreaterThan(PI_TRANSCRIPT_MAX_BYTES - 300);
    expect(moduleEventReplySchema.safeParse({ id: "near-bound", result: { result: page } }).success).toBe(true);
    // String length alone fits; JSON escaping takes this complete item over budget.
    await writeFile(path, assistant("before" + "\n".repeat(PI_TRANSCRIPT_MAX_BYTES / 2) + "after"));
    const oversized = await piTranscriptPage({ sessionDir, limit: 300 });
    expect(oversized.items).toEqual([]); expect(oversized.gaps).toMatchObject([{ reason: "item_too_large", item: 0 }]);
    const tail = await piTranscript({ sessionDir, limit: 1 });
    expect(tail).toHaveLength(1);
    expect(tail[0]).toMatchObject({ at: "", kind: "text", text: expect.stringContaining("[Pi transcript gap] 1 inspected items omitted") });
    expect(moduleEventReplySchema.safeParse({ id: "gap-tail", result: { result: tail } }).success).toBe(true);
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});

test.each(["user", "assistant"])("Pi legacy tail skips a partial UTF-8 %s record beyond 1 MiB and preserves the complete recent answer", async role => {
  const sessionDir = await mkdtemp("/tmp/chrona-pi-recent-source-");
  try {
    const excluded = JSON.stringify({ type: "message", message: { role, content: "🙂".repeat(300000) } }) + "\n";
    let text = "recent visible answer 检查🙂", source = Buffer.from(excluded + assistant(text).trimEnd());
    // Put the suffix boundary inside a multibyte character, not just inside JSON.
    while ((source[source.length - 1024 * 1024] & 0xc0) !== 0x80) {
      text += "."; source = Buffer.from(excluded + assistant(text).trimEnd());
    }
    await writeFile(join(sessionDir, "a.jsonl"), assistant("older file outside the source window"));
    await writeFile(join(sessionDir, "z.jsonl"), source);
    expect(source.length).toBeGreaterThan(1024 * 1024);
    const tail = await piTranscript({ sessionDir, limit: 3 });
    expect(tail).toHaveLength(2);
    expect(tail[0]).toMatchObject({ kind: "text", text: expect.stringContaining("Earlier source content was not inspected") });
    expect(tail[1]).toEqual({ at: "2026-11-07T12:00:00Z", kind: "text", text });
    expect(moduleEventReplySchema.safeParse({ id: "recent-source", result: { result: tail } }).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(tail))).toBeLessThanOrEqual(PI_TRANSCRIPT_MAX_BYTES);
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});

test("Pi legacy source suffix preserves a complete record exactly at its read boundary", async () => {
  const sessionDir = await mkdtemp("/tmp/chrona-pi-source-boundary-");
  try {
    const first = assistant("first complete boundary answer"), last = assistant("last answer");
    const ignored = JSON.stringify({ type: "message", message: { role: "user", content: "" } }) + "\n";
    const padding = "x".repeat(1024 * 1024 - Buffer.byteLength(first + ignored + last));
    const window = first + ignored.replace('"content":""', `"content":"${padding}"`) + last;
    expect(Buffer.byteLength(window)).toBe(1024 * 1024);
    await writeFile(join(sessionDir, "source.jsonl"), assistant("omitted prefix") + window);
    const tail = await piTranscript({ sessionDir, limit: 3 });
    expect(tail).toHaveLength(3);
    expect(tail[0]).toMatchObject({ kind: "text", text: expect.stringContaining("Earlier source content was not inspected") });
    expect(tail.slice(1).map(item => item.kind === "text" && item.text)).toEqual(["first complete boundary answer", "last answer"]);
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});
