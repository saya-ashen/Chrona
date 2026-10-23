import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHRONA_TOOLS } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createRuns } from "./runs";
import { createTools, searchSessions, sessionContentFocus } from "./tools";
import type { StewardPorts } from "./ports";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "tools" } })).id;
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:tools", source: "web" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-tools-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null, chat: null, deliveries: [] };
});
afterEach(async () => { await db.$disconnect(); });
async function capability() {
  const runs = createRuns(ports, workspaceId);
  await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
  return (await runs.claimNext("foreground"))!;
}
test("focus validates module names and persists a mount selection for the next run", async () => {
  await db.module.createMany({ data: [{ workspaceId, name: "files", builtin: true }, { workspaceId, name: "notes" }, { workspaceId, name: "web", builtin: true }] });
  const run = await capability(), tools = createTools(ports);
  expect(await tools.call(run.token, "chrona_focus", { modules: ["notes", "files", "notes"] })).toEqual({ modules: ["notes", "files"] });
  expect(await sessionContentFocus(db, workspaceId, sessionId)).toEqual(["notes", "files"]);
  for (const name of ["missing", "web", "qq", "mcp"]) await expect(tools.call(run.token, "chrona_focus", { modules: [name] })).rejects.toMatchObject({ code: "invalid" });
});
test("search groups bounded snippets by session, includes ended history and isolates workspaces", async () => {
  const ended = await db.session.create({ data: { workspaceId, key: "web:old", source: "web", status: "ended", title: "Old context" } });
  await db.message.createMany({ data: [
    { workspaceId, sessionId, direction: "in", channel: "in_app", text: "Remember the telescope" },
    { workspaceId, sessionId, direction: "out", channel: "in_app", text: "Telescope details" },
    { workspaceId, sessionId: ended.id, direction: "out", channel: "in_app", text: "An old telescope" },
  ] });
  const other = await db.workspace.create({ data: { name: "Other" } });
  const foreign = await db.session.create({ data: { workspaceId: other.id, key: "web:foreign", source: "web" } });
  await db.message.create({ data: { workspaceId: other.id, sessionId: foreign.id, direction: "in", channel: "in_app", text: "Secret telescope" } });
  const results = await searchSessions(db, workspaceId, "telescope", 10);
  expect(results).toHaveLength(2);
  expect(results.find(result => result.sessionId === sessionId)?.snippets).toHaveLength(2);
  expect(results.find(result => result.sessionId === ended.id)?.title).toBe("Old context");
  expect(JSON.stringify(results)).not.toContain("Secret");
  expect(await searchSessions(db, workspaceId, "%")).toEqual([]);
  expect(await searchSessions(db, workspaceId, "telescope", 1)).toHaveLength(1);
});
test("session search tool and foreground reply match the contract", async () => {
  const run = await capability(), tools = createTools(ports);
  expect(CHRONA_TOOLS).toContain("chrona_session_search");
  const result = await tools.call(run.token, "chrona_reply", { text: "Answer" });
  expect(result).toHaveProperty("messageId");
  const messages = await db.message.findMany({ where: { sessionId } });
  expect(messages[0]?.text).toBe("Answer");
  expect(await tools.call(run.token, "chrona_session_search", { query: "Answer" })).toHaveLength(1);
});
