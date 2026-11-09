import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePiSessionResume } from "./pi-session-resume";

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-pi-resume-"));
  const sessionDir = join(cwd, "pi");
  await mkdir(sessionDir);
  const input = { cwd, sessionDir, sessionId: "saved-provider-id" };
  const header = { type: "session", version: 3, id: input.sessionId, cwd, timestamp: new Date().toISOString() };
  return { input, header, file: join(sessionDir, "2026-11-08_saved-provider-id.jsonl") };
}

describe("Pi execution resume context", () => {
  test("accepts a matching header independent of filename and ignores the transcript body", async () => {
    const f = await fixture();
    await writeFile(join(f.input.sessionDir, "unrelated.jsonl"), "invalid json\n");
    await writeFile(join(f.input.sessionDir, "arbitrary-name.jsonl"), JSON.stringify(f.header) + "\n" + "invalid transcript body".repeat(100_000));
    expect(await validatePiSessionResume(f.input)).toBeNull();
  });
  test.each(["directory", "empty", "wrong-id", "wrong-cwd", "no-cwd", "relative-cwd", "wrong-type", "malformed", "oversized", "second-line", "other-extension", "nested"])("rejects %s context", async kind => {
    const f = await fixture();
    const header: Record<string, unknown> = { ...f.header };
    if (kind === "wrong-id") header.id = "another-id";
    if (kind === "wrong-cwd") header.cwd = join(f.input.cwd, "other-project");
    if (kind === "no-cwd") delete header.cwd;
    if (kind === "relative-cwd") header.cwd = ".";
    if (kind === "wrong-type") header.type = "message";
    let contents = JSON.stringify(header) + "\n";
    if (kind === "malformed") contents = "not json\n";
    if (kind === "oversized") contents = JSON.stringify({ ...header, padding: "x".repeat(1024 * 1024) }) + "\n";
    if (kind === "second-line") contents = "\n" + contents;
    if (kind === "nested") { await mkdir(join(f.input.sessionDir, "nested")); await writeFile(join(f.input.sessionDir, "nested", "session.jsonl"), contents); }
    else if (kind !== "directory" && kind !== "empty") await writeFile(kind === "other-extension" ? f.file + ".txt" : f.file, contents);
    const error = await validatePiSessionResume(kind === "directory" ? { ...f.input, sessionDir: join(f.input.sessionDir, "absent") } : f.input);
    expect(error).toContain(kind.endsWith("cwd") ? "cwd" : "context");
  });
  test("accepts CRLF, a header without a trailing newline and lexical cwd normalization", async () => {
    const f = await fixture();
    for (const suffix of ["\r\n", ""]) {
      await writeFile(f.file, JSON.stringify({ ...f.header, cwd: join(f.input.cwd, "child", "..") }) + suffix);
      expect(await validatePiSessionResume(f.input)).toBeNull();
    }
  });
  test("preserves UTF-8 split across a read boundary", async () => {
    const f = await fixture();
    await writeFile(f.file, '{"padding":"' + "x".repeat(4084) + '界",' + JSON.stringify(f.header).slice(1) + "\n");
    expect(await validatePiSessionResume(f.input)).toBeNull();
  });
});
