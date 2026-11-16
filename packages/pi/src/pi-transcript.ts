import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProviderTranscriptItem } from "@chrona/contracts/steward";

/** Leave room below the ordinary 256 KiB module result bound, including cursors and gaps. */
export const PI_TRANSCRIPT_MAX_BYTES = 192 * 1024;
const READ_BYTES = 1024 * 1024;
const cursorSchema = z.object({
  v: z.literal(1), file: z.string().min(1).max(8192), identity: z.string().max(128),
  offset: z.number().int().nonnegative().safe(), size: z.number().int().nonnegative().safe(), item: z.number().int().min(0).max(READ_BYTES), skip: z.boolean(),
}).strict();
type Cursor = z.infer<typeof cursorSchema>;
export type PiTranscriptGap = { file: string; offset: number; bytes: number; reason: "record_too_large" | "item_too_large" | "malformed_record"; item?: number };
export type PiTranscriptPage = { items: ProviderTranscriptItem[]; nextCursor: string | null; gaps: PiTranscriptGap[] };
export type PiTranscriptPageInput = { sessionDir: string; limit: number; cursor?: string };
function failure(code: "too_large" | "invalid" | "cursor_expired") {
  return Object.assign(new Error(`Pi transcript ${code}`), { code });
}
function encode(cursor: Cursor) {
  const value = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  if (value.length > 16384) throw failure("too_large");
  return value;
}
function validateLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw failure("invalid");
}
function decode(value: string): Cursor {
  try {
    if (value.length > 16384 || !/^[\w-]+$/.test(value)) throw failure("invalid");
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch { throw failure("invalid"); }
}
async function filesIn(sessionDir: string) {
  return (await readdir(sessionDir, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  })).filter(name => name.endsWith(".jsonl")).sort();
}

type Block = { type?: string; text?: string; name?: string; arguments?: unknown };
type Entry = { type?: string; timestamp?: string; message?: { role?: string; content?: (Block | null)[] | string; toolName?: string; isError?: boolean } };
function items(entry: Entry): ProviderTranscriptItem[] {
  const message = entry.message, at = entry.timestamp ?? "";
  if (entry.type !== "message" || !message) return [];
  const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? message.content.filter((block): block is Block => block !== null && typeof block === "object") : [];
  if (message.role === "assistant") return blocks.flatMap<ProviderTranscriptItem>(block => {
    if (block.type === "text" && block.text?.trim()) return [{ at, kind: "text", text: block.text.trim() }];
    if (block.type === "toolCall" && block.name) return [{ at, kind: "tool", tool: block.name, args: JSON.stringify(block.arguments ?? {}) }];
    return [];
  });
  if (message.role !== "toolResult") return [];
  return [{ at, kind: "result", tool: message.toolName ?? "", text: blocks.filter(block => block.type === "text").map(block => block.text ?? "").join("\n"), error: message.isError === true }];
}
function parse(line: Buffer, file: string, offset: number): ProviderTranscriptItem[] | null {
  let entry: Entry | null;
  try { entry = JSON.parse(line.toString("utf8")) as Entry | null; }
  catch (error) {
    console.error(JSON.stringify({ component: "pi-transcript", event: "malformed_record", file, offset, bytes: line.length,
      error: error instanceof SyntaxError ? "Invalid JSON record" : String(error) }));
    return null;
  }
  return entry && typeof entry === "object" ? items(entry).map((item, block) => ({ ...item, id: `${file}:${offset}:${block}` })) : [];
}


/** Source ranges end at record boundaries; only oversized ranges may continue. */
function* segments(data: Buffer, eof: boolean, skipping: boolean) {
  for (let offset = 0; offset < data.length;) {
    const newline = data.indexOf(10, offset), end = newline < 0 ? data.length : newline + 1;
    const gap = skipping || (newline < 0 && !eof && offset === 0);
    // Retry an ordinary record from its start when it crosses the read window.
    if (!gap && newline < 0 && !eof) return;
    skipping = gap && newline < 0 && !eof;
    yield { end, gap, skip: skipping };
    offset = end;
  }
}
function scanPage(data: Buffer, state: Cursor, size: number, nextFileCursor: string | null, limit: number): PiTranscriptPage {
  const page: PiTranscriptPage = { items: [], gaps: [], nextCursor: null };
  const file = state.file, eof = state.offset + data.length >= size;
  function continuation(offset: number, item: number, skip: boolean) {
    return state.offset + offset < size || item || skip
      ? encode({ ...state, size, offset: state.offset + offset, item, skip }) : nextFileCursor;
  }
  const overhead = (nextCursor: string | null) => Buffer.byteLength(JSON.stringify({ items: [], gaps: [], nextCursor }));
  let offset = 0, used = 0, blockIndex = state.item, skipping = state.skip;
  function add(value: ProviderTranscriptItem | PiTranscriptGap, nextCursor: string | null, gap = false) {
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
    if (used + bytes + overhead(nextCursor) > PI_TRANSCRIPT_MAX_BYTES || page.items.length + page.gaps.length >= limit) return false;
    used += bytes;
    if (gap) page.gaps.push(value as PiTranscriptGap); else page.items.push(value as ProviderTranscriptItem);
    return true;
  }
  for (const segment of segments(data, eof, skipping)) {
    const { end, gap, skip } = segment;
    if (gap) {
      const gap: PiTranscriptGap = { file, offset: state.offset + offset, bytes: end - offset, reason: "record_too_large" };
      if (!add(gap, continuation(end, 0, skip), true)) break;
      skipping = skip; offset = end; blockIndex = 0;
      continue;
    }
    const normalized = parse(data.subarray(offset, end), file, state.offset + offset);
    if (normalized === null) {
      if (!add({ file, offset: state.offset + offset, bytes: end - offset, reason: "malformed_record" }, continuation(end, 0, false), true)) break;
      offset = end; blockIndex = 0;
      continue;
    }
    for (; blockIndex < normalized.length; blockIndex++) {
      const item = normalized[blockIndex];
      const bytes = Buffer.byteLength(JSON.stringify(item));
      const nextCursor = blockIndex + 1 < normalized.length ? continuation(offset, blockIndex + 1, false) : continuation(end, 0, false);
      const added = bytes + 1 + overhead(nextCursor) > PI_TRANSCRIPT_MAX_BYTES
        ? add({ file, offset: state.offset + offset, bytes, reason: "item_too_large", item: blockIndex }, nextCursor, true)
        : add(item, nextCursor);
      if (!added) break;
    }
    if (blockIndex < normalized.length) break;
    if (used + overhead(continuation(end, 0, false)) > PI_TRANSCRIPT_MAX_BYTES) break;
    offset = end; blockIndex = 0;
  }
  page.nextCursor = continuation(offset, blockIndex, skipping);
  return page;
}

/**
 * Forward paging over complete normalized items. A page scans at most 1 MiB of
 * one file, so even ignored records cannot monopolize the SDK's event queue.
 * Byte offsets refer to the source JSONL; an oversized record is skipped with
 * explicit gap ranges, never a partial UTF-8 string or a clipped tool result.
 */
export async function piTranscriptPage({ sessionDir, limit, cursor }: PiTranscriptPageInput): Promise<PiTranscriptPage> {
  validateLimit(limit);
  const files = await filesIn(sessionDir), position = cursor === undefined ? undefined : decode(cursor);
  const fileIndex = position ? files.indexOf(position.file) : 0;
  if (position && fileIndex < 0) throw failure("cursor_expired");
  const page: PiTranscriptPage = { items: [], nextCursor: null, gaps: [] };
  if (!files.length) return page;
  const file = files[fileIndex];
  const handle = await open(join(sessionDir, file), "r").catch((error: NodeJS.ErrnoException) => {
    if (position && error.code === "ENOENT") throw failure("cursor_expired");
    throw error;
  });
  try {
    const stat = await handle.stat(), identity = `${stat.dev}:${stat.ino}`;
    const state: Cursor = position ?? { v: 1, file, identity, offset: 0, size: stat.size, item: 0, skip: false };
    if (state.identity !== identity || state.offset > stat.size || stat.size < state.size) throw failure("cursor_expired");
    const buffer = Buffer.alloc(Math.min(READ_BYTES, stat.size - state.offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, state.offset);
    if (bytesRead !== buffer.length) throw failure("cursor_expired");
    const data = buffer.subarray(0, bytesRead);
    let nextFileCursor: string | null = null;
    if (fileIndex + 1 < files.length) {
      const nextFile = files[fileIndex + 1], next = await open(join(sessionDir, nextFile), "r");
      try {
        const nextStat = await next.stat();
        nextFileCursor = encode({ v: 1, file: nextFile, identity: `${nextStat.dev}:${nextStat.ino}`, offset: 0, size: nextStat.size, item: 0, skip: false });
      } finally { await next.close(); }
    }
    return scanPage(data, state, stat.size, nextFileCursor, limit);
  } finally { await handle.close(); }
}


function transcriptTail(limit: number) {
  const entries: { item: ProviderTranscriptItem; bytes: number }[] = [];
  let bytes = 2, count = 0;
  return {
    append(items: ProviderTranscriptItem[]) {
      for (const item of items) {
        count++;
        const size = Buffer.byteLength(JSON.stringify(item)) + 1;
        entries.push({ item, bytes: size }); bytes += size;
        while (entries.length && (entries.length > limit || bytes > PI_TRANSCRIPT_MAX_BYTES)) bytes -= entries.shift()!.bytes;
      }
    },
    result(sourceOmitted = false): ProviderTranscriptItem[] {
      if (!sourceOmitted && entries.length === Math.min(count, limit)) return entries.map(entry => entry.item);
      // The legacy array has no gap field. Reserve one item for an explicit
      // notice so ordinary transcript readers can still display a usable tail.
      const sourceNotice = sourceOmitted ? "Earlier source content was not inspected; only a recent complete-record window was read. " : "";
      const notice = (): ProviderTranscriptItem => ({ at: "", kind: "text", text: `[Pi transcript gap] ${sourceNotice}${count - entries.length} inspected items omitted from this bounded tail. Request page:true and follow nextCursor for forward pages; oversized items are reported as gaps.` });
      while (entries.length && (entries.length >= limit || bytes + Buffer.byteLength(JSON.stringify(notice())) + 1 > PI_TRANSCRIPT_MAX_BYTES)) bytes -= entries.shift()!.bytes;
      return [notice(), ...entries.map(entry => entry.item)];
    },
  };
}

/** Read only the recent source window, plus one byte to verify its record boundary. */
async function recentSource(sessionDir: string) {
  const files = await filesIn(sessionDir), chunks: { data: Buffer; file: string; offset: number }[] = [];
  let remaining = READ_BYTES, omitted = false;
  for (let index = files.length - 1; index >= 0; index--) {
    if (!remaining) { omitted = true; break; }
    const handle = await open(join(sessionDir, files[index]), "r");
    try {
      const stat = await handle.stat(), length = Math.min(remaining, stat.size), start = stat.size - length;
      const buffer = Buffer.alloc(length + (start > 0 ? 1 : 0));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, start - 1));
      if (bytesRead !== buffer.length) throw failure("cursor_expired");
      remaining -= length;
      let data = buffer;
      if (start > 0) {
        omitted = true;
        // Never decode a suffix beginning inside a JSON record or UTF-8 code point.
        const newline = buffer.indexOf(10);
        data = newline < 0 ? buffer.subarray(buffer.length) : buffer.subarray(newline + 1);
      }
      chunks.push({ data, file: files[index], offset: Math.max(0, start - 1) + buffer.length - data.length });
    } finally { await handle.close(); }
  }
  return { chunks: chunks.reverse(), omitted };
}

/**
 * Legacy tail contract. Bound source scanning to a recent 1 MiB window and
 * retained JSON bytes, with an explicit notice for unread source or items.
 * Thinking, user prompts and non-message records never enter the transcript.
 */
export async function piTranscript({ sessionDir, limit }: { sessionDir: string; limit: number }): Promise<ProviderTranscriptItem[]> {
  validateLimit(limit);
  const tail = transcriptTail(limit), source = await recentSource(sessionDir);
  for (const chunk of source.chunks) {
    const { data, file } = chunk;
    for (let offset = 0; offset < data.length;) {
      const newline = data.indexOf(10, offset), end = newline < 0 ? data.length : newline + 1;
      const parsed = parse(data.subarray(offset, end), file, chunk.offset + offset);
      tail.append(parsed ?? [{ id: `${file}:${chunk.offset + offset}:gap`, at: "", kind: "text", text: "[Pi transcript gap] malformed_record" }]);
      offset = end;
    }
  }
  return tail.result(source.omitted);
}
