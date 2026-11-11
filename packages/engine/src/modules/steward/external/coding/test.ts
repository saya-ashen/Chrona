import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error Chrona supplies the isolated author test kernel.
import { startModule } from "chrona/testing";
import { kernelAgentInputs } from "./kernel-contract.js";

const dir = await mkdtemp(join(tmpdir(), "coding-author-")), projectPath = join(dir, "project"); await mkdir(projectPath);
const previous = { module: process.env.CHRONA_MODULE, data: process.env.CHRONA_DATA, content: process.env.CHRONA_CONTENT };
process.env.CHRONA_MODULE = import.meta.dir; process.env.CHRONA_DATA = dir; process.env.CHRONA_CONTENT = join(dir, "public");
let prompt = "", sequence = 0;
const runs = new Map<string, { runId: string; contextId: string; status: string; active: boolean }>();
const runtime = await startModule(join(import.meta.dir, "index.ts"), { stubs: {
  "agent.run": (raw: Record<string, unknown>, options: { key?: string }) => {
    const args = kernelAgentInputs.run.parse(raw); assert.match(options.key!, /^coding-[a-f0-9]{64}$/);
    prompt = args.prompt; assert.equal(raw.cwd, undefined); assert.equal(raw.workId, undefined); assert.equal(raw.budget, undefined); assert.equal(raw.requestKey, undefined);
    const run = { runId: `run-${++sequence}`, contextId: args.contextId ?? "context-1", status: "running", active: true }; runs.set(run.runId, run); return { ...run };
  },
  "agent.read": (raw: Record<string, unknown>) => {
    const args = kernelAgentInputs.read.parse(raw), run = runs.get(args.runId)!;
    return { run: { ...run }, items: [], nextCursor: null, ended: !run.active, interactions: [], transcript: [] };
  },
  "agent.write": (raw: Record<string, unknown>, options: { key?: string }) => { kernelAgentInputs.write.parse(raw); assert.ok(options.key); return { accepted: true }; },
  "agent.stop": (raw: Record<string, unknown>, options: { key?: string }) => {
    const args = kernelAgentInputs.stop.parse(raw); assert.ok(options.key);
    const run = runs.get(args.runId)!; run.status = "cancelled"; run.active = false; return { ...run, stopConfirmed: true };
  },
} });
try {
  const now = new Date().toISOString();
  const invoke = (caller: object | undefined, command: unknown, id = "command") => runtime.send({ trigger: { kind: "tool", id, firedAt: now, args: { input: JSON.stringify(command) }, ...(caller ? { caller } : {}) }, now, params: {} });
  const owner = { kind: "owner", via: null }, app = { kind: "module", module: "client", moduleId: "uses-star-app", hash: "approved" };
  for (const caller of [undefined, { kind: "provider", runId: "provider" }]) assert.equal((await invoke(caller, { op: "projects.list" }) as { errorCode?: string }).errorCode, "forbidden");
  assert.equal((await invoke(owner, { op: "projects.list", cwd: "/host" }) as { errorCode?: string }).errorCode, "invalid");
  assert.equal((await invoke(owner, { op: "projects.list" }, "ui-list") as { errorCode?: string }).errorCode, "invalid");
  assert.deepEqual((await invoke(app, { op: "projects.list" })).result?.result, { projects: [], defaultProjectRef: null });
  const registered = (await invoke(owner, { op: "projects.register", requestKey: "register", path: projectPath })).result?.result as { receipt: { value: { projectRef: string } } };
  const created = (await invoke(owner, { op: "conversations.create", requestKey: "create", projectRef: registered.receipt.value.projectRef, title: "Two clients" })).result?.result as { receipt: { sessionId: string } };
  const sessionId = created.receipt.sessionId, send = { op: "round.send", requestKey: "send", sessionId, workId: null, text: "Implement fixture" };
  const sent = (await invoke(app, send)).result?.result as { receipt: { status: string; workId: string } };
  assert.equal(sent.receipt.status, "accepted"); assert.ok(prompt.includes("AGENTS.md")); assert.ok(prompt.includes(projectPath));
  const http = async (raw: unknown) => {
    const response = await runtime.fetch("/api/coding/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(raw) });
    return { status: response.status, body: await response.json() as { result?: unknown; error?: { code: string } } };
  };
  const duplicate = await http(send); assert.equal(duplicate.status, 200); assert.deepEqual(duplicate.body.result, sent);
  const conflict = await http({ ...send, text: "Changed" }); assert.equal(conflict.status, 409); assert.equal(conflict.body.error?.code, "conflict");
  const detail = await http({ op: "conversations.get", sessionId }); assert.equal(detail.status, 200);
  assert.equal((detail.body.result as { session: { currentWorkId: string } }).session.currentWorkId, sent.receipt.workId);
  assert.equal((await http({ op: "round.send", requestKey: "followup", sessionId, workId: sent.receipt.workId, text: "Follow up" })).status, 200);
  assert.equal((await http({ op: "round.stop", requestKey: "stop", sessionId, workId: sent.receipt.workId, runId: "run-1", attemptId: "run-1" })).status, 200);
  assert.equal((await http({ op: "round.send", requestKey: "continue", sessionId, workId: sent.receipt.workId, text: "Next round" })).status, 200);
  assert.equal(runs.get("run-2")!.contextId, "context-1");
  const calls = runtime.calls.filter((call: { method: string }) => call.method === "call") as { params: { target?: unknown; key?: string } }[];
  assert.equal(calls.filter(call => call.params.target === "agent.run").length, 2);
  assert.ok(calls.every(call => typeof call.params.target === "string" && ["agent.run", "agent.read", "agent.write", "agent.stop"].includes(call.params.target)));
} finally {
  await runtime.stop();
  for (const [key, value] of Object.entries({ CHRONA_MODULE: previous.module, CHRONA_DATA: previous.data, CHRONA_CONTENT: previous.content })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(dir, { recursive: true, force: true });
}
