import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
// @ts-expect-error Chrona supplies the test kernel at this sandbox-only path.
import { startModule } from "/chrona/testing.ts";

const module = await startModule("/module/index.ts");
const now = "2026-10-22T00:00:00Z";
async function tool(id: string, args: Record<string, unknown> = {}) {
  const reply = await module.send({ trigger: { kind: "tool", id, firedAt: now, args }, now, params: {} });
  assert.equal(reply.error, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(reply.result.result)) <= 16_384);
  return reply.result.result;
}
try {
  assert.deepEqual(await tool("write", { path: "notes/report.txt", content: "first" }), { ok: true });
  assert.equal((await tool("read", { path: "notes/report.txt" })).content, "first");
  const first = (await tool("history", { path: "notes/report.txt" })).versions[0].version;
  await writeFile("/content/notes/report.txt", "external");
  const edit = await module.send({ trigger: { kind: "content_edit", id: "content", firedAt: now, paths: ["notes/report.txt"], by: "provider" }, now, params: {} });
  assert.equal(edit.error, undefined);
  assert.equal((await tool("history", { path: "notes/report.txt" })).versions.length, 2);
  assert.deepEqual(await tool("restore", { path: "notes/report.txt", version: first }), { ok: true });
  assert.equal((await tool("read", { path: "notes/report.txt" })).content, "first");
  assert.deepEqual(await tool("move", { from: "notes", to: "reports" }), { ok: true });
  const deleted = await tool("delete", { path: "reports" });
  assert.ok(deleted.path.startsWith(".trash/"));
  assert.equal((await tool("read", { path: deleted.path + "/report.txt" })).content, "first");
  for (const path of ["../escape", "/etc/passwd", ".git/config", "notes/../escape", "notes/.git/config"]) {
    assert.ok((await tool("write", { path, content: "no" })).error);
  }
  await tool("write", { path: "long.txt", content: '😀"\\\n'.repeat(3000) });
  const long = await tool("read", { path: "long.txt" });
  assert.equal(long.truncated, true); assert.ok(long.content.endsWith("[truncated]"));
  await writeFile("/content/binary.bin", Buffer.from([0, 255, 1]));
  const binary = await tool("read", { path: "binary.bin" });
  assert.equal(binary.size, 3); assert.equal(typeof binary.mime, "string"); assert.equal(binary.content, undefined);
  for (let i = 0; i < 25; i++) await tool("write", { path: "versions.txt", content: String(i) });
  assert.equal((await tool("history", { path: "versions.txt" })).versions.length, 20);
  assert.ok((await tool("list")).entries.some((entry: { name: string }) => entry.name === ".trash"));
  assert.deepEqual(module.calls, []);
} finally { await module.stop(); }
