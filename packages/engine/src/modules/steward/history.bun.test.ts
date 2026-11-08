import { expect, test } from "bun:test";
import { agentFixture } from "./agent-application.fixtures";
import { callSync, kernelOrigin, listSystemModules } from "./module-calls";

test("historical reads stay scoped and cannot expose new Agent contexts or restore removed public controls", async () => {
  const f = await agentFixture();
  try {
    const origin = { ...kernelOrigin(f.workspaceId), caller: { kind: "owner" as const, via: null } };
    const read = async (target: string, args: Record<string, unknown> = {}) => (await callSync(f.ports, origin, target, args)).output;
    const legacy = await f.ports.db.session.create({ data: { workspaceId: f.workspaceId, source: "web", key: "web:historical" } });
    const context = await f.ports.db.session.create({ data: { workspaceId: f.workspaceId, source: "module", key: "module:private", moduleId: f.module.id } });
    await f.ports.db.audit.create({ data: { id: `agent-context:${context.id}`, workspaceId: f.workspaceId, actorKey: "test", kind: "agent_context", subjectId: context.id, details: {} } });
    const other = await f.ports.db.workspace.create({ data: { name: "other-history" } });
    const foreign = await f.ports.db.session.create({ data: { workspaceId: other.id, source: "web", key: "web:foreign" } });
    expect((await read("history.sessions") as { id: string }[]).map(row => row.id)).toEqual([legacy.id]);
    expect(await read("history.session", { session: legacy.id })).toMatchObject({ id: legacy.id });
    expect(await read("history.messages", { session: legacy.id })).toEqual([]);
    for (const id of [context.id, foreign.id]) for (const tool of ["session", "messages", "transcript"])
      await expect(read(`history.${tool}`, { session: id })).rejects.toMatchObject({ code: "not_found" });
    await expect(read("history.file", { message: "missing", ref: "chat/foreign" })).rejects.toMatchObject({ code: "not_found" });
    for (const target of ["chat.send", "provider.wake", "provider.complete", "executions.start", "history.send", "history.cancel"])
      await expect(read(target)).rejects.toMatchObject({ code: "not_found" });
    expect(listSystemModules().find(module => module.name === "history")?.tools.map(tool => tool.name)).toEqual(["sessions", "session", "messages", "transcript"]);
    expect(listSystemModules().some(module => ["chat", "provider", "executions"].includes(module.name))).toBe(false);
    expect(await f.ports.db.run.count()).toBe(1);
  } finally { await f.close(); }
}, 30000);
