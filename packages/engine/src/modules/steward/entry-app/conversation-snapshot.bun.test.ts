import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentConversations } from "./conversations";
import { createAgentConversations as web } from "../external/web/agent-conversations";
import { createAgentConversations as mcp } from "../external/mcp/agent-conversations";
import { createAgentConversations as qq } from "../external/qq/agent-conversations";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const at = "2026-11-09T00:00:00.000Z";
function session(source: "web" | "mcp" | "qq", count = 137) {
  return {
    id: `${source}-agent:legacy`, source, key: "private-key", contextId: "private-context", title: "历史会话", status: "active",
    createdAt: at, lastActivityAt: at, memory: { provider: "memory-local", recalled: true, retainedThrough: null },
    messages: Array.from({ length: count }, (_, i) => ({ id: `message-${i}`, direction: "in" as const, text: `saved-${i}`, createdAt: at, attachments: [{ ref: `ref-${i}`, metadata: { title: "saved" } }] })),
    // An active turn without a final reply would trigger Agent refresh in messages()/execution().
    turns: [{ id: "turn", key: "request", text: "saved", at, runId: "run-legacy", status: "running", active: true, phase: "saved-phase", streamPending: true, baseline: [], transcript: [], interactions: [] }],
  };
}
async function fixture(create = createAgentConversations, source: "web" | "mcp" | "qq" = "web") {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-journal-snapshot-")); directories.push(dataDir);
  const directory = join(dataDir, "conversations"), path = join(directory, "state.json");
  await mkdir(directory);
  const saved = session(source);
  await writeFile(path, JSON.stringify({ version: 1, sessions: [saved] }));
  // A fixed old mtime detects atomic saves even if the serialized bytes are unchanged.
  await utimes(path, new Date(at), new Date(at));
  const calls: unknown[] = [], replies: unknown[] = [];
  const app = create({ dataDir, source, call: async (...args) => { calls.push(args); throw new Error("offline: calls forbidden"); }, reply: event => { replies.push(event); }, deliveryPages: async () => { calls.push("deliveryPages"); throw new Error("offline: delivery forbidden"); } });
  const disk = async () => ({ bytes: await readFile(path, "utf8"), mtime: (await stat(path)).mtimeMs, ino: (await stat(path)).ino, files: await readdir(directory) });
  return { app, saved, path, disk, calls, replies };
}

for (const [label, create, source] of [
  ["shared", createAgentConversations, "web"], ["generated web", web, "web"], ["generated mcp", mcp, "mcp"], ["generated qq", qq, "qq"],
] as const) test(`${label}: snapshot is bounded persisted history with no calls, replies or file mutation`, async () => {
  const f = await fixture(create, source), before = await f.disk();
  const snapshot = await f.app.snapshot(f.saved.id);
  expect(snapshot.session).toEqual({ id: f.saved.id, source, title: "历史会话", status: "active", createdAt: at, lastActivityAt: at });
  expect(snapshot.messages).toEqual(f.saved.messages.slice(-100));
  expect(snapshot.messages).toHaveLength(100);
  expect(snapshot.messages[0]?.id).toBe("message-37");
  expect(snapshot.execution).toMatchObject({ runId: "run-legacy", status: "running", active: true, phase: "saved-phase", canContinue: false, replyPending: false });
  expect(await f.app.list()).toHaveLength(1);
  expect(f.calls).toEqual([]);
  expect(f.replies).toEqual([]);
  expect(await f.disk()).toEqual(before);
});

test("snapshot and list reads are detached, including nested attachments and memory metadata", async () => {
  const f = await fixture(), before = await f.disk();
  const first = await f.app.snapshot(f.saved.id), original = structuredClone(first);
  first.session.title = "changed";
  first.messages[0]!.text = "changed";
  (first.messages[0]!.attachments[0] as { metadata: { title: string } }).metadata.title = "changed";
  first.messages.pop();
  first.execution!.status = "changed";
  const listed = await f.app.list();
  listed[0]!.memory!.provider = "changed";
  listed.pop();
  expect(await f.app.snapshot(f.saved.id)).toEqual(original);
  expect((await f.app.snapshot(f.saved.id)).execution?.status).toBe("running");
  expect((await f.app.list())[0]?.memory?.provider).toBe("memory-local");
  expect(await f.disk()).toEqual(before);
});

test("missing, invalid and other-entry identities return not_found without effects", async () => {
  const f = await fixture();
  const foreign = session("qq");
  const wrongSource = { ...session("mcp"), id: "web-agent:wrong-source" };
  await writeFile(f.path, JSON.stringify({ version: 1, sessions: [f.saved, foreign, wrongSource] }));
  const before = await f.disk();
  for (const id of ["", "invalid", "web-agent:missing", foreign.id, wrongSource.id, null as unknown as string]) {
    await expect(f.app.snapshot(id)).rejects.toMatchObject({ code: "not_found" });
  }
  expect(f.calls).toEqual([]);
  expect(f.replies).toEqual([]);
  expect(await f.disk()).toEqual(before);
});

test("empty history has no execution; an unadmitted turn stays historical without admission", async () => {
  const f = await fixture();
  f.saved.messages = []; f.saved.turns = [];
  await writeFile(f.path, JSON.stringify({ version: 1, sessions: [f.saved] }));
  expect(await f.app.snapshot(f.saved.id)).toMatchObject({ messages: [], execution: null });
  const pending = { ...session("web", 1), turns: [{ ...session("web").turns[0]!, runId: undefined, status: "pending" }] };
  await writeFile(f.path, JSON.stringify({ version: 1, sessions: [pending] }));
  const before = await f.disk();
  expect(await f.app.snapshot(f.saved.id)).toMatchObject({ messages: pending.messages, execution: null });
  expect(f.calls).toEqual([]);
  expect(f.replies).toEqual([]);
  expect(await f.disk()).toEqual(before);
});
