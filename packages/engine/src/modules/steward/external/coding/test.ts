import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error Chrona supplies the isolated author test kernel.
import { startModule } from "chrona/testing";

// Exercise the shipped entry and SDK boundary without importing/connecting the SDK in this parent.
const dir = await mkdtemp(join(tmpdir(), "coding-author-"));
const previous = { module: process.env.CHRONA_MODULE, data: process.env.CHRONA_DATA, content: process.env.CHRONA_CONTENT };
process.env.CHRONA_MODULE = import.meta.dir; process.env.CHRONA_DATA = dir; process.env.CHRONA_CONTENT = join(dir, "public");
const projects = [{ projectRef: "repo", path: "/fixture/project", label: "Fixture" }];
const views = new Map<string, Record<string, unknown>>(); let prompt = "";
const runtime = await startModule(join(import.meta.dir, "index.ts"), { stubs: {
  "agent.work-projects": (args: Record<string, unknown>) => { assert.equal(args.action, "list"); return { action: "list", principal: { workspaceId: "fixture-workspace", ownerId: "owner", caller: { kind: "module", moduleId: "coding", hash: "fixture-hash" } }, projects }; },
  "agent.work-run": (args: Record<string, unknown>) => {
    prompt = String(args.prompt); assert.equal(args.cwd, undefined);
    const workId = String(args["execution-id"]), view = { workId, projectRef: "repo", sessionId: "agent-session", runId: "run-1", attemptId: "attempt-1", status: "running", cancelRequested: false, stopConfirmed: false };
    views.set(workId, view); return { execution: view };
  },
  "agent.work-get": (args: Record<string, unknown>) => views.get(String(args["execution-id"])),
  "agent.work-stream": () => ({ events: [], cursor: "cursor-0", highWatermark: 0, gap: false, snapshotRequired: false }),
  "agent.work-inspect": (args: Record<string, unknown>) => {
    const view = views.get(String(args["execution-id"]))!;
    return { snapshot: { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId, status: view.status, cancelRequested: false, stopConfirmed: false, highWatermark: 0, finalMessage: null, questions: [], missing: false, expiresAt: "2099-12-01T00:00:00Z" } };
  },
} });
try {
  const now = new Date().toISOString();
  const invoke = (caller: object | undefined, command: unknown, id = "command") => runtime.send({ trigger: { kind: "tool", id, firedAt: now, args: { input: JSON.stringify(command) }, ...(caller ? { caller } : {}) }, now, params: {} });
  const owner = { kind: "owner", via: null }, app = { kind: "module", moduleId: "uses-star-app", hash: "approved" };
  for (const caller of [undefined, { kind: "provider", runId: "provider" }]) assert.equal((await invoke(caller, { op: "projects.list" }) as { errorCode?: string }).errorCode, "forbidden");
  assert.equal((await invoke(owner, { op: "projects.list", cwd: "/host" }) as { errorCode?: string }).errorCode, "invalid");
  assert.equal((await invoke(owner, { op: "projects.list" }, "ui-list") as { errorCode?: string }).errorCode, "invalid");
  assert.deepEqual((await invoke(app, { op: "projects.list" })).result?.result, { projects, defaultProjectRef: null });
  const created = (await invoke(owner, { op: "conversations.create", requestKey: "create", projectRef: "repo", title: "Two clients" })).result?.result as { receipt: { sessionId: string } };
  const sessionId = created.receipt.sessionId, send = { op: "round.send", requestKey: "send", sessionId, workId: null, text: "Implement fixture" };
  const sent = (await invoke(app, send)).result?.result as { receipt: { status: string; workId: string } };
  assert.equal(sent.receipt.status, "accepted"); assert.ok(prompt.includes("read AGENTS.md relative to the actual execution cwd"));
  const http = async (raw: unknown) => {
    const response = await runtime.fetch("/api/coding/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(raw) });
    return { status: response.status, body: await response.json() as { result?: unknown; error?: { code: string } } };
  };
  const duplicate = await http(send); assert.equal(duplicate.status, 200); assert.deepEqual(duplicate.body.result, sent);
  const conflict = await http({ ...send, text: "Changed" }); assert.equal(conflict.status, 409); assert.equal(conflict.body.error?.code, "conflict");
  const detail = await http({ op: "conversations.get", sessionId }); assert.equal(detail.status, 200);
  assert.equal((detail.body.result as { session: { currentWorkId: string } }).session.currentWorkId, sent.receipt.workId);
  assert.equal(runtime.calls.filter((call: { params: { target?: unknown } }) => targetName(call.params.target) === "agent.work-run").length, 1);
  assert.ok(runtime.calls.every((call: { params: { target?: unknown } }) => String(targetName(call.params.target)).startsWith("agent.")));
} finally {
  await runtime.stop();
  for (const [key, value] of Object.entries({ CHRONA_MODULE: previous.module, CHRONA_DATA: previous.data, CHRONA_CONTENT: previous.content })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(dir, { recursive: true, force: true });
}

function targetName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const target = raw as { moduleId: string; tool: string };
  const names: Record<string, string> = {};
  return `${names[target.moduleId] ?? target.moduleId.replace(/-id$/, "")}.${target.tool}`;
}
