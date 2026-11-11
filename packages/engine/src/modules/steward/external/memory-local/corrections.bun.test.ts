import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { corrections } from "./corrections";

test("durable correction repairs a lost write, rejects conflict and prevents resurrection after deletion", async () => {
  const data = await mkdtemp("/tmp/chrona-memory-correct-"), entries = new Map([["id", "old fact"]]);
  let fail = true;
  const backend = { get: (id: string) => entries.has(id) ? { content: entries.get(id) } : null, update: (id: string, content: string) => { if (fail) throw new Error("index interrupted"); entries.set(id, content); return true; }, forget: (id: string) => entries.delete(id) };
  let journal = corrections(data);
  try {
    expect(() => journal.correct(backend, "id", "old fact", "new fact", "owner:direct", "2026-11-11T00:00:00Z")).toThrow("index interrupted");
    journal.close(); journal = corrections(data); fail = false; journal.repair(backend);
    expect(entries.get("id")).toBe("new fact");
    expect(journal.correct(backend, "id", "old fact", "new fact", "owner:direct", "later")).toMatchObject({ at: "2026-11-11T00:00:00Z" });
    expect(() => journal.correct(backend, "id", "old fact", "another fact", "owner:direct", "later")).toThrow("Memory changed");
    expect(() => journal.checkRetention("old fact")).toThrow("corrected or deleted");
    expect(journal.forget(backend, "id", "owner:direct", "later")).toEqual({ forgotten: true });
    expect(entries.has("id")).toBe(false);
    expect(() => journal.checkRetention("new fact")).toThrow("corrected or deleted");
    journal.close(); journal = corrections(data); journal.repair(backend);
    expect(journal.forget(backend, "id", "owner:direct", "later")).toEqual({ forgotten: true });
  } finally { journal.close(); await rm(data, { recursive: true, force: true }); }
});

test("unsupported deletion fails closed instead of exposing an undeleted memory", async () => {
  const data = await mkdtemp("/tmp/chrona-memory-correct-");
  const journal = corrections(data), backend = { get: () => ({ content: "fact" }), update: () => false, forget: () => false };
  try {
    expect(() => journal.forget(backend, "id", "owner:direct", "now")).toThrow("deletion could not be applied");
    expect(() => journal.repair(backend)).toThrow("deletion could not be applied");
  } finally { journal.close(); await rm(data, { recursive: true, force: true }); }
});
