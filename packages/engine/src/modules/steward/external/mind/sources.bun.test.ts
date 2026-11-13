import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { MindStore } from "./store";
import { MindService } from "./service";
import { MindSources } from "./sources";

test("Files observations bind identity, dedupe across restart, reject truncation and pause with Mind", async () => {
  const dir = await mkdtemp("/tmp/chrona-mind-sources-");
  const store = new MindStore(dir), service = new MindService(store);
  let description = "Original documentation";
  let identity = "files-id", content = "first", truncated = false, reads = 0;
  const call = async (target: string | { moduleId: string; tool: string }, _args: unknown, options?: unknown) => {
    if (target === "modules.describe") return { source: { kind: "module", hash: "v1" }, description, sideEffects: [] };
    reads++; expect(target).toEqual({ moduleId: "files-id", tool: "read" });
    expect(options).toMatchObject({ expectedTarget: { moduleId: "files-id" } });
    return { content, truncated, size: content.length, mime: "text/plain" };
  };
  let sources = new MindSources(store, service, () => identity, call);
  try {
    await sources.configure({ paths: "report.txt" });
    await sources.poll("2026-11-11T12:00:00Z"); expect(reads).toBe(0);
    await store.update(state => { state.settings.enabled = true; });
    await sources.poll("2026-11-11T12:00:00Z");
    expect((await store.read()).signals).toHaveLength(1);
    sources = new MindSources(store, service, () => identity, call);
    await sources.configure({ paths: "report.txt" });
    await sources.poll("2026-11-11T12:01:00Z"); expect((await store.read()).signals).toHaveLength(1);
    description = "Updated documentation";
    content = "second"; truncated = true;
    await sources.poll("2026-11-11T12:02:00Z"); expect((await store.read()).signals).toHaveLength(1);
    truncated = false; await sources.poll("2026-11-11T12:03:00Z");
    expect((await store.read()).signals.at(-1)).toMatchObject({ source: "files", moduleId: "files-id", text: "second" });
    identity = "replacement"; const before = reads;
    await sources.poll("2026-11-11T12:04:00Z"); expect(reads).toBe(before);
    expect((await store.read()).sources?.[0]?.error).toBeTruthy();
    await sources.configure({ paths: "" });
    await sources.poll("2026-11-11T12:05:00Z"); expect(reads).toBe(before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("legacy source hashes parse and refresh after a Files description upgrade", async () => {
  const dir = await mkdtemp("/tmp/chrona-mind-sources-legacy-");
  const store = new MindStore(dir), service = new MindService(store);
  try {
    await store.update(state => {
      state.settings.enabled = true;
      state.sources = [{ path: "report.txt", moduleId: "files-id", contractHash: "a".repeat(64), version: null, error: null }];
    });
    const restarted = new MindStore(dir);
    expect((await restarted.read()).sources?.[0]?.contractHash).toBe("a".repeat(64));
    const sources = new MindSources(restarted, service, () => "files-id", async (target, _args, options) => {
      if (target === "modules.describe") return { source: { kind: "module", hash: "v2" }, description: "Updated documentation", sideEffects: [] };
      expect(options?.expectedTarget).toEqual({ moduleId: "files-id" });
      return { content: "fresh evidence", truncated: false, size: 14, mime: "text/plain" };
    });
    await sources.poll("2026-11-11T12:00:00Z");
    expect((await restarted.read()).signals.at(-1)).toMatchObject({ moduleId: "files-id", text: "fresh evidence" });
    expect((await restarted.read()).sources?.[0]?.error).toBeNull();
    await sources.configure({ paths: "new.txt" });
    expect((await restarted.read()).sources?.[0]).not.toHaveProperty("contractHash");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
