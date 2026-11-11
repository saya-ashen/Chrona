import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preferences } from "./preferences";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
test("corrected preferences survive reopening, reject stale edits and can be deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-preference-")); roots.push(root);
  const store = preferences(root), original = await store.remember("简短回复", "ui", "2026-11-11T12:00:00Z");
  const corrected = await store.correct(original.id, original.text, "详细解释");
  expect(corrected.id).toBe(original.id);
  expect(await preferences(root).list()).toEqual([{ ...original, text: "详细解释" }]);
  expect(await store.correct(original.id, original.text, "详细解释")).toEqual(corrected);
  await expect(store.correct(original.id, original.text, "只用英文")).rejects.toThrow("changed");
  await store.forget(original.id); expect(await preferences(root).list()).toEqual([]);
});
test("concurrent preference writes preserve both records and serialize conflicting corrections", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-preference-")); roots.push(root);
  const store = preferences(root);
  const [a] = await Promise.all([store.remember("中文", "general", "2026-11-11T12:00:00Z"), store.remember("深色", "ui", "2026-11-11T12:00:00Z")]);
  expect(await store.list()).toHaveLength(2);
  const changed = await Promise.allSettled([store.correct(a!.id, "中文", "英文"), store.correct(a!.id, "中文", "日文")]);
  expect(changed.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
});
