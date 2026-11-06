import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { createExecutions } from "./execution";
import { createRuns } from "./runs";
import { createExecutionEventStore } from "./execution-event-store";
import { executionRunInput } from "./execution-context";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "coding-context" } })).id;
  const module = await db.module.create({ data: { workspaceId, name: "coding", activeHash: "hash", status: "active" } });
  const project = await mkdtemp(join(tmpdir(), "chrona-coding-context-project-"));
  await writeFile(join(project, "AGENTS.md"), "Fixture project rules");
  await db.preference.create({ data: { workspaceId, text: "PRIVATE PERSONAL PREFERENCE", topic: "private", origin: "user" } });
  const other = await db.session.create({ data: { workspaceId, source: "web", key: "web:secret", providerSessionId: "unrelated-provider" } });
  await db.message.create({ data: { workspaceId, sessionId: other.id, direction: "in", channel: "in_app", text: "PRIVATE OTHER SESSION" } });
  const ports: StewardPorts = { db, now: () => new Date("2026-11-05T12:00:00Z"), publicUrl: null, dataDir: await mkdtemp(join(tmpdir(), "chrona-coding-context-data-")),
    resolveExecutionProject: async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: project, baseline: "commit:fixture" }) };
  ports.executionEvents = createExecutionEventStore(ports);
  const principal: ExecutionPrincipal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  const ref = await createExecutions(ports).start(principal, { workId: "work", projectRef: "fixture", commandKey: "start", goal: "FIXTURE GOAL", budget: { timeoutMs: 10_000, maxToolCalls: 2 } });
  const run = (await createRuns(ports, workspaceId).claimNext("background"))!;
  return { db, ports, project, principal, ref, run };
}
test("coding context uses trusted cwd and isolated logs, no personal memory, mind or inherited session", async () => {
  const f = await fixture(), input = (await executionRunInput(f.ports, f.run))!;
  expect(input.cwd).toBe(f.project);
  expect(input.sessionDir).toBe(join(f.ports.dataDir, "sessions", f.ref.sessionId));
  expect(input.sessionId).toBeNull(); expect(input.execution).toMatchObject({ attemptId: f.ref.attemptId });
  expect(input.prompt).toContain("Fixture project rules"); expect(input.prompt).toContain("FIXTURE GOAL"); expect(input.prompt).toContain("commit:fixture");
  expect(input.prompt).not.toContain("PRIVATE"); expect(input.prompt).not.toContain("unrelated-provider");
  expect(input.content).toEqual([]); expect(input.hostPaths).toEqual([]); expect(input.searchTools).toBe(false);
});
test("project mapping and active immutable caller are revalidated after queue boundary", async () => {
  const f = await fixture();
  f.ports.resolveExecutionProject = async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: f.project, baseline: "snapshot:changed" });
  await expect(executionRunInput(f.ports, f.run)).rejects.toMatchObject({ code: "conflict" });
  await f.db.module.update({ where: { id: f.principal.caller.kind === "module" ? f.principal.caller.moduleId : "" }, data: { status: "paused" } });
  await expect(executionRunInput(f.ports, f.run)).rejects.toMatchObject({ code: "forbidden" });
});
test("device attempts and missing local cwd cannot resolve or read a server project", async () => {
  const f = await fixture();
  const resolveProject = mock(async () => { throw new Error("must not resolve a device project locally"); });
  f.ports.resolveExecutionProject = resolveProject;
  for (const data of [{ executorId: "device", resolvedCwd: f.project }, { executorId: "server", resolvedCwd: null }]) {
    await f.db.executionAttempt.update({ where: { id: f.ref.attemptId }, data });
    await expect(executionRunInput(f.ports, f.run)).rejects.toMatchObject({ code: "conflict" });
  }
  expect(resolveProject).not.toHaveBeenCalled();
});
test("one sequence spans normalized Pi details and actual channel question IDs; final snapshot survives detail failure", async () => {
  const f = await fixture(), input = (await executionRunInput(f.ports, f.run))!;
  const { projectRef: _, status: __, cancelRequested: ___, stopConfirmed: ____, ...ref } = f.ref;
  await input.detail!.append({ ...ref, seq: 1, at: f.ports.now().toISOString(), payload: { type: "state", status: "running", cancelRequested: false, stopConfirmed: false } });
  await input.onInteraction({ id: "actual-channel-id", runId: ref.runId, sessionId: ref.sessionId, createdAt: f.ports.now().toISOString(), expiresAt: new Date(f.ports.now().getTime() + 1000).toISOString(), status: "pending", question: { method: "confirm", title: "Question", message: "private request body", options: [], timeoutMs: 1000 } });
  await f.db.executionAttempt.update({ where: { id: ref.attemptId }, data: { detailBytes: 10 * 1024 * 1024 } });
  await expect(input.detail!.append({ ...ref, seq: 2, at: f.ports.now().toISOString(), payload: { type: "message", messageId: "final", role: "assistant", text: "Final result", complete: true } })).rejects.toMatchObject({ code: "capacity" });
  const details = await f.db.executionDetail.findMany({ where: { attemptId: ref.attemptId }, orderBy: { seq: "asc" } });
  expect(details.map(event => event.seq)).toEqual([1, 2]);
  const snapshot = await f.ports.executionEvents!.snapshot(f.principal, ref);
  expect(snapshot.questions[0]!.requestId).toBe("actual-channel-id");
  expect(JSON.stringify(snapshot)).not.toContain("private request body");
  expect(snapshot.finalMessage!.text).toBe("Final result");
  expect(snapshot.missing).toBe(true);
});
