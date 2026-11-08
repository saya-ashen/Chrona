import assert from "node:assert/strict";
import { settingsSpec, liveGrant, scheduleActions } from "./src/system/settings";

export function checkSettingsRules() {
  const now = Date.parse("2026-11-04T10:00:00Z"), base = { id: "g", action: "read_source", mode: "allow", scope: { kind: "global" } };
  for (const [patch, expected] of [[{}, true], [{ revokedAt: "2026-11-01" }, false], [{ once: true, consumedAt: "2026-11-01" }, false], [{ once: false, consumedAt: "2026-11-01" }, true], [{ once: true }, true], [{ expiresAt: "2026-11-04T10:00:00Z" }, false], [{ expiresAt: "2026-11-04T09:59:59Z" }, false], [{ expiresAt: "2026-11-04T10:00:01Z" }, true]] as const) assert.equal(liveGrant({ ...base, ...patch }, now), expected);
  for (const [status, label, next] of [["active", "暂停", "paused"], ["paused", "恢复", "active"]]) {
    const actions = scheduleActions({ id: "schedule", mode: "cron", status: status! });
    assert.deepEqual(actions[0], { label, tool: "schedule-update", args: { id: "schedule", status: next } });
    assert.deepEqual(actions[1], { label: "取消", tool: "schedule-update", args: { id: "schedule", status: "cancelled" }, confirm: "取消这个日程？" });
  }
  assert.match(JSON.stringify(settingsSpec({})), /加载中/);
}
export function checkSettingsSpec() {
  const settings = { timezone: "UTC", notifications: { dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "09:00" }, builds: { dailyLimit: 10, timeoutMinutes: 30, maxSubmissions: 3 }, buildUsage: { date: "2026-11-04", timezone: "UTC", used: 2, remaining: 8 } };
  const settingsView = { settings, schedules: [], grants: [], preferences: [] };
  const empty = JSON.stringify(settingsSpec({ settingsView }));
  for (const text of ["2026-11-04（UTC）：今日新建 2 / 10，剩余 8 个。", "尚未配置：模块不能调用模型。", "今天还没有模块调用模型。", "没有日程。", "没有授权规则。", "还没有。"]) assert.ok(empty.includes(text), text);
  const spec = settingsSpec({ apps: [{ id: "app /", name: "example" }], systemApps: [{ name: "system /" }], settingsView: { ...settingsView,
    secrets: [{ modules: ["example"], configured: false }],
    schedules: [{ id: "active", mode: "module", status: "active", nextAt: "2026-11-05T10:00:00Z" }, { id: "paused", label: "暂停日程", mode: "module", status: "paused" }, { id: "dead", label: "已结束隐藏", mode: "module", status: "done" }],
    grants: [{ id: "g", action: "read_source", mode: "ask", scope: { kind: "global" } }], preferences: [{ id: "p", text: "偏好中文" }],
  } });
  const serialized = JSON.stringify(spec);
  for (const text of ["/apps/app%20%2F?tab=settings", "/apps/system/system%20%2F?tab=settings", "凭据未设置", "已暂停", "Time", "read_source · 先问我", "全部", "偏好中文", "删除这条偏好？"]) assert.ok(serialized.includes(text), text);
  assert.ok(!serialized.includes("已结束隐藏"));
  const actions = Object.values(spec.elements).filter(node => node.type === "SystemAction");
  assert.equal(actions.filter(node => node.props.tool === "schedule-update").length, 4);
}
