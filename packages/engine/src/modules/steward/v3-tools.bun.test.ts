import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHRONA_TOOLS } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createRuns } from "./runs";
import { createTools, searchSessions } from "./tools";
import type { StewardPorts } from "./ports";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "tools" } })).id;
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:tools", source: "web" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-tools-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null };
});
afterEach(async () => { await db.$disconnect(); });
async function capability() {
  const runs = createRuns(ports, workspaceId);
  await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
  return (await runs.claimNext("foreground"))!;
}
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

test("reply files are copied from the run's directory into chat's store; links out of it and unknown attachments are refused", async () => {
  const run = await capability(), tools = createTools(ports);
  await mkdir(run.cwd, { recursive: true });
  await writeFile(join(run.cwd, "report.txt"), "done");
  const outside = join(ports.dataDir, "secret.txt"); await writeFile(outside, "secret");
  await symlink(outside, join(run.cwd, "link.txt"));
  const { messageId } = await tools.call(run.token, "chrona_reply", { text: "Here", files: ["report.txt"] }) as { messageId: string };
  const [file] = (await db.message.findUniqueOrThrow({ where: { id: messageId } })).attachments as { name: string; ref: string }[];
  expect(file!.name).toBe("report.txt");
  expect(await readFile(join(ports.dataDir, "platform/data", file!.ref), "utf8")).toBe("done");
  // A received attachment is attached again by its path under content/chat/.
  await tools.call(run.token, "chrona_reply", { text: "Again", files: [`content/${file!.ref}`] });
  await expect(tools.call(run.token, "chrona_reply", { text: "No", files: ["link.txt"] })).rejects.toMatchObject({ code: "forbidden" });
  await expect(tools.call(run.token, "chrona_reply", { text: "No", files: ["content/chat/missing.txt"] })).rejects.toMatchObject({ code: "not_found" });
  // An app's content by reference (e.g. a generated image): attached without passing through a tool result.
  const app = await db.module.create({ data: { workspaceId, name: "image-generation", activeHash: "i1" } });
  await mkdir(join(ports.dataDir, "platform/content", app.id), { recursive: true });
  await writeFile(join(ports.dataDir, "platform/content", app.id, "cat.png"), "png-bytes");
  const sent = await tools.call(run.token, "chrona_reply", { text: "图", files: ["content/image-generation/cat.png"] }) as { messageId: string };
  const [image] = (await db.message.findUniqueOrThrow({ where: { id: sent.messageId } })).attachments as { name: string; ref: string }[];
  expect([image!.name, await readFile(join(ports.dataDir, "platform/data", image!.ref), "utf8")]).toEqual(["cat.png", "png-bytes"]);
  await expect(tools.call(run.token, "chrona_reply", { text: "No", files: ["content/image-generation/missing.png"] })).rejects.toMatchObject({ code: "not_found" });
  await symlink(outside, join(ports.dataDir, "platform/content", app.id, "escape.txt"));
  await expect(tools.call(run.token, "chrona_reply", { text: "No", files: ["content/image-generation/escape.txt"] })).rejects.toMatchObject({ code: "not_found" });
});
