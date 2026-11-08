import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { paths, startModule } from "chrona/testing";

let failRegistration = false;
const module = await startModule("index.ts", { stubs: { "web.page-set": () => {
  if (failRegistration) return { error: "web temporarily unavailable" };
  return { id: "main", catalog: "json-render@0.21.4" };
} } });
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
  assert.deepEqual(await tool("write", { path: "notes/report.txt", content: "second" }), { ok: true });
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
  await writeFile(`${paths.content}/binary.bin`, Buffer.from([0, 255, 1]));
  const binary = await tool("read", { path: "binary.bin" });
  assert.equal(binary.size, 3); assert.equal(typeof binary.mime, "string"); assert.equal(binary.content, undefined);
  for (let i = 0; i < 25; i++) await tool("write", { path: "versions.txt", content: String(i) });
  assert.equal((await tool("history", { path: "versions.txt" })).versions.length, 20);
  const root = await tool("list");
  assert.ok(root.entries.some((entry: { name: string }) => entry.name === ".trash"));
  assert.equal(root.dir, ""); assert.equal(root.parent, null);
  await tool("write", { path: "a/b/c.md", content: "# c" });
  assert.deepEqual(await tool("list", { dir: "a/b" }), { dir: "a/b", parent: "a", entries: [{ name: "c.md", kind: "file", path: "a/b/c.md" }], truncated: false });
  assert.deepEqual(module.calls, []);
  // On activation the documents page is registered with web.
  assert.equal((await module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} })).error, undefined);
  const registered = module.calls.find((call: { method: string; params: { target: string } }) => call.params.target === "web.page-set");
  assert.equal(registered.params.args.id, "main"); assert.equal(registered.params.args.data.doc.tool, "read");
  const activate = () => module.send({ trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
  assert.equal((await activate()).error, undefined);
  failRegistration = true;
  assert.ok((await activate()).error, "Failed registration must reach the existing activated retry mechanism");
  failRegistration = false;
  assert.equal((await activate()).error, undefined);
  const registrations = module.calls.filter((call: { params: { target?: string } }) => call.params.target === "web.page-set");
  assert.equal(registrations.length, 4);
  assert.ok(registrations.every((call: { params: { args: { id: string } } }) => call.params.args.id === "main"));
} finally { await module.stop(); }
