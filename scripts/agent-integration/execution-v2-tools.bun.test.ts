import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { agent } from "../../packages/engine/src/modules/steward/system/agent";
import { registeredRunFixture, eventually } from "./registered-run.fixtures";

test("kernel exposes exactly the seven registered Provider APIs", () => {
  expect(agent.tools.map(tool => tool.name).sort()).toEqual(["native", "providers", "read", "register", "run", "stop", "write"]);
});

test("actual external Pi registration pins public run admission, replay, ownership and queued stop", async () => {
  const f = await registeredRunFixture();
  try {
    expect(f.module.builtin).toBe(false);
    const providers = await f.call<{ items: { id: string; moduleId: string; hash: string; available: boolean }[] }>("providers", {});
    expect(providers.items).toContainEqual(expect.objectContaining({ id: "pi", moduleId: f.module.id, hash: f.module.activeHash, available: true }));
    const binding = await f.ports.db.agentRunProvider.findUniqueOrThrow({ where: { runId: f.admitted.runId } });
    expect(binding).toMatchObject({ moduleId: f.module.id, hash: f.module.activeHash, revision: f.registration.revision });
    expect(await f.call<typeof f.admitted>("run", f.input, "start")).toEqual(f.admitted);
    expect(await f.ports.db.run.count({ where: { sessionId: f.admitted.contextId } })).toBe(1);
    await expect(f.call("run", { ...f.input, prompt: "changed" }, "start")).rejects.toMatchObject({ code: "conflict" });
    const other = await f.caller("other-caller");
    await expect(f.call("read", { runId: f.admitted.runId }, undefined, other)).rejects.toBeTruthy();
    await expect(f.call("run", { ...f.input, contextId: f.admitted.contextId }, "foreign", other)).rejects.toBeTruthy();
    const stopped = await f.call("stop", { runId: f.admitted.runId }, "queued-stop");
    expect(stopped).toMatchObject({ status: "cancelled", stopConfirmed: true, active: false });
    expect(await f.ports.db.providerLaunch.count({ where: { runId: f.admitted.runId } })).toBe(0);
    expect(await f.call("read", { runId: f.admitted.runId })).toMatchObject({ ended: true, interactions: [] });
  } finally { await f.close(); }
}, 30000);

test("public write/native/read/stop use the same SDK-owned fake Pi process and preserve native records", async () => {
  const f = await registeredRunFixture();
  try {
    const { run, handle } = await f.launch();
    await eventually(() => f.ports.db.runEvent.findMany({ where: { runId: run.id, kind: "raw" } }), rows => rows.some(row => (row.payload as { value?: { type?: string } }).value?.type === "agent_start"));
    const pid = await readFile(join(run.cwd, "pi.pid"), "utf8");
    const native = await f.call<{ response: Record<string, unknown> }>("native", { runId: run.id, request: { type: "future_backend_feature", id: "caller-id", value: "opaque", nested: { extension: [1, { ok: true }] } } }, "native");
    expect(native.response).toMatchObject({ type: "response", id: "caller-id", command: "future_backend_feature", success: true, data: { nested: { extension: [1, { ok: true }] }, value: "opaque" }, backendField: { retained: true } });
    expect(await f.call<typeof native>("native", { runId: run.id, request: { type: "future_backend_feature", id: "caller-id", value: "opaque", nested: { extension: [1, { ok: true }] } } }, "native")).toEqual(native);
    expect(await f.call<{ accepted: boolean }>("write", { runId: run.id, input: { kind: "message", text: "Follow up" } }, "write")).toEqual({ accepted: true });
    const raw = await eventually(() => f.call<{ items: { kind: string; payload: { type: string; value: Record<string, unknown> } }[]; nextCursor: string }>("read", { runId: run.id, view: "native", limit: 100 }), page => page.items.some(item => item.payload.value.type === "future_notice"));
    expect(raw.items.every(item => item.kind === "raw")).toBe(true);
    expect(raw.items).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ type: "raw", value: expect.objectContaining({ type: "future_notice", nested: { extension: [1, { ok: true }] } }) }) }));
    const normalized = await f.call<{ items: { kind: string }[] }>("read", { runId: run.id });
    expect(normalized.items.some(item => item.kind === "progress")).toBe(true);
    expect(normalized.items.every(item => item.kind !== "raw")).toBe(true);
    await expect(f.call("read", { runId: run.id, cursor: raw.nextCursor, view: "normalized" })).rejects.toMatchObject({ code: "invalid" });
    const commands = (await readFile(join(run.cwd, "commands.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(commands.filter(command => command.type === "future_backend_feature")).toHaveLength(1);
    expect(commands.some(command => command.type === "prompt" && command.message === "Follow up" && command.streamingBehavior === "steer")).toBe(true);
    expect(await readFile(join(run.cwd, "pi.pid"), "utf8")).toBe(pid);
    await f.call("stop", { runId: run.id }, "stop");
    const stopped = await eventually(() => f.call("stop", { runId: run.id }, "stop"), result => result.stopConfirmed === true);
    expect(stopped).toMatchObject({ stopConfirmed: true, active: false });
    expect((await handle.done).outcome).not.toBe("succeeded");
    expect((await f.call("read", { runId: run.id })).ended).toBe(true);
    const audit = JSON.stringify(await f.ports.db.moduleInvocation.findMany());
    expect(audit).not.toContain("Offline acceptance prompt");
    expect(audit).not.toContain("Follow up");
    expect(audit).not.toContain("future_backend_feature");
  } finally { await f.close(); }
}, 30000);
