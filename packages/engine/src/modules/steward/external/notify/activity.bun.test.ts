import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { testDb } from "../../test-db";
import { registerSystemModules } from "../../system-modules";
import { callSync, kernelOrigin } from "../../module-calls";
import type { StewardPorts } from "../../ports";
import { activityView } from "./activity";

test("Notify presents current public record pages newest first, groups incidents and pages locally", async () => {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-notify-activity-");
  try {
    const workspace = await db.workspace.create({ data: { name: "Notify activity regression" } });
    const notify = await db.module.create({ data: { workspaceId: workspace.id, name: "notify" } });
    const busy = await db.module.create({ data: { workspaceId: workspace.id, name: "busy" } });
    let time = Date.parse("2026-11-01T00:00:00Z");
    const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(time) };
    const owner = { ...kernelOrigin(workspace.id), caller: { kind: "owner" as const, via: null } };
    const inputs: Record<string, unknown>[] = [];
    const call = async (target: string, input: Record<string, unknown>) => {
      expect(target).toBe("activity.records");
      expect(input.limit).toBe(100);
      inputs.push(input);
      return (await callSync(ports, owner, target, input)).output;
    };
    const view = (args: Parameters<typeof activityView>[1] = {}) => activityView(call, args);
    expect(await view()).toEqual({ items: [], before: null });
    const add = (kind: string, subjectId: string | null, details: object) => db.audit.create({ data: {
      workspaceId: workspace.id, actorKey: "chrona", kind, subjectId, details, createdAt: new Date(time += 1000),
    } });
    const quiet = await add("module_activate", notify.id, { hash: "quiet123" });
    for (let i = 0; i < 301; i++) await add("module_activate", busy.id, { hash: "busy1234" });
    await add("module_runtime_incident", notify.id, { id: "incident", status: "retrying", failures: 1 });
    for (let i = 0; i < 201; i++) await add("grant_created", null, { reason: "green module update" });
    const newest = await add("module_runtime_incident", notify.id, { id: "incident", status: "recovered", deliveryUnknown: true });
    await add("tool_started", notify.id, { raw: "hidden-internal-row" });
    inputs.length = 0;
    const filtered = await view({ module: "notify" });
    expect(inputs).toHaveLength(6);
    expect(filtered).toEqual({ items: [
      { id: newest.id, at: newest.createdAt.toISOString(), kind: "module_runtime_incident", module: "notify",
        text: "notify 已验证恢复（未重放失败调用；此前有结果未知的调用，请核对外部效果）（共 2 次更新）" },
      { id: quiet.id, at: quiet.createdAt.toISOString(), kind: "module_activate", module: "notify", text: "notify 已切换到版本 quiet123" },
    ], before: null });
    const first = await view({ limit: 2 });
    expect(first.items[0]!.id).toBe(newest.id);
    expect(first.items[1]!.module).toBe("busy");
    expect(first.before).toBe(first.items[1]!.at);
    const older = await view({ before: first.before!, limit: 2 });
    expect(older.items).toHaveLength(2);
    expect(older.items.every(item => item.at < first.before!)).toBe(true);
    expect(await view({ module: "missing" })).toEqual({ items: [], before: null });
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 60_000);

test("Notify retains its 2,000-record presentation scan bound", async () => {
  const items = Array.from({ length: 2001 }, (_, i) => ({ id: String(i), at: new Date(i * 1000).toISOString(),
    kind: "module_enabled", subject: "app", module: i ? "busy" : "quiet", hash: null, approvalTitle: null, details: {} }));
  const call = async () => ({ items, nextCursor: null });
  expect(await activityView(call, { module: "quiet" })).toEqual({ items: [], before: null });
  expect((await activityView(call, { module: "quiet", before: items.at(-1)!.at })).items).toMatchObject([{ id: "0", module: "quiet" }]);
});
