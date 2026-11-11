import assert from "node:assert/strict";
import { settingsSpec, settingsData } from "./src/system/settings";
import { detailData, detailSpec, selectedTab } from "./src/system/detail";
import { pagesForApp, settingsPageForApp, settingsUnavailable } from "./src/system/registered-pages";

export function checkSettingsRules() {
  assert.match(JSON.stringify(settingsSpec({})), /加载中/);
  assert.equal(selectedTab("settings"), "settings");
  assert.equal(selectedTab("settings", true), "overview");
  assert.deepEqual(detailData({ id: "fixture-id", tab: "tools", session: "" }, false).pages, { tool: "pages", refresh: 5 });
}
export function checkSettingsSpec() {
  const app = { id: "app/1", name: "example", status: "active", activeHash: "active" };
  const page = { module: "example", moduleId: app.id, id: "preferences", title: "应用偏好", purpose: "settings" as const };
  const pages = [
    { ...page, moduleId: "replaced-owner" },
    { ...page, module: "neighbor" },
    { ...page, id: "settings", purpose: undefined },
    page,
  ];
  assert.equal(settingsPageForApp(pages, app), page);
  assert.equal(pagesForApp(pages, app).length, 2);
  for (const status of ["paused", "migrating"]) {
    assert.equal(settingsPageForApp(pages, { ...app, status }), undefined);
    assert.match(settingsUnavailable(pages, { ...app, status }), /恢复后/);
  }
  assert.match(settingsUnavailable(undefined, app), /正在读取/);
  assert.match(settingsUnavailable([], app), /尚未登记/);
  assert.equal(settingsPageForApp(pages, { ...app, activeHash: "" }), undefined);
  const caps = { maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, eventTimeoutMs: 120000, moduleDailyCalls: { example: 0 } };
  const state = { settingsView: { settings: { timezone: "UTC", runTimeoutMinutes: null, moduleModel: caps, modelUsage: [{ module: "example", calls: 0, inputTokens: 4, outputTokens: 8 }],
    // Stale application projections must not restore application forms.
    memory: { provider: "memory-local" }, notifications: { dailyCap: 5 } }, agent: { ready: true }, preferences: [{ id: "p", text: "旧偏好" }] }, apps: [app], pages };
  const spec = settingsSpec(state), nodes = Object.values(spec.elements), text = JSON.stringify(spec);
  assert.deepEqual(nodes.filter(node => node.type === "Card").map(node => node.props.title), ["登录密码", "内核", "应用设置"]);
  assert.ok(nodes.some(node => node.type === "Link" && node.props.href === "/apps/app%2F1?tab=settings"));
  assert.match(text, /上限 0/);
  assert.deepEqual(nodes.find(node => node.type === "RunTimeoutSettings")!.props, { settings: { timezone: "UTC", runTimeoutMinutes: null } });
  assert.deepEqual(nodes.filter(node => ["NotificationSettings", "ModuleModelSettings"].includes(node.type)).map(node => node.props.section), ["budget", "caps"]);
  assert.ok(!nodes.some(node => node.type === "AgentSettings"));
  assert.match(text, /今日应用模型调用用量/);
  assert.match(text, /已报告输入/);
  for (const removed of ["通知设置", "旧偏好", "preference-forget", "autoRecall", "memory-local"]) assert.ok(!text.includes(removed), removed);
  assert.match(JSON.stringify(settingsSpec({ ...state, pages: [] })), /尚未登记/);
  assert.match(JSON.stringify(settingsSpec({ ...state, pages: undefined })), /正在读取应用设置入口/);
  assert.match(JSON.stringify(settingsSpec({ ...state, apps: [{ ...app, status: "paused" }] })), /恢复后/);
  assert.match(JSON.stringify(settingsSpec({ apps: [], pages: [] })), /还没有安装应用/);
  assert.match(JSON.stringify(settingsSpec({ settingsView: { settings: { timezone: "UTC" } } })), /尚未启用模型调用额度/);
  assert.deepEqual(settingsData, { settingsView: { tool: "settings" }, pages: { tool: "pages", refresh: 30 }, apps: { tool: "modules", refresh: 5 } });
  const overview = { app: { ...app, origin: "external", capabilities: {}, health: {} } };
  for (const tab of ["overview", "settings", "tools"]) {
    const detail = detailSpec({ overview, pages }, { id: app.id, tab, session: "" });
    const tabs = Object.values(detail.elements).find(node => node.type === "TabNav")!.props.items as { label: string; href: string }[];
    assert.equal(tabs.find(item => item.label === "设置")!.href, "/apps/app%2F1?tab=settings");
    const embedded = Object.values(detail.elements).filter(node => node.type === "AppSettings");
    assert.equal(embedded.length, tab === "settings" ? 1 : 0);
    if (tab === "settings") assert.deepEqual(embedded[0]!.props, { ...page, activeHash: app.activeHash });
    if (tab === "overview") assert.ok(Object.values(detail.elements).some(node => node.type === "Link" && node.props.href === "/apps/app%2F1?tab=settings"));
  }
  const unavailable = JSON.stringify(detailSpec({ overview, pages: [] }, { id: app.id, tab: "settings", session: "" }));
  assert.match(unavailable, /尚未登记设置页面/);
  assert.ok(!unavailable.includes("AppSettings"));
  for (const owner of [{ ...app, status: "paused" }, { ...app, activeHash: "" }]) {
    assert.ok(!JSON.stringify(detailSpec({ overview: { app: { ...overview.app, ...owner } }, pages }, { id: app.id, tab: "settings", session: "" })).includes("AppSettings"));
  }
}
