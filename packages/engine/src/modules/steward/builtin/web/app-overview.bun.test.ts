import { expect, test } from "bun:test";
import { appOverview, systemApps } from "./app-overview";

function fixture() {
  const calls: [string, Record<string, unknown>][] = [];
  const app = { id: "app-id", name: "files", origin: "builtin", capabilities: { build: true, remove: false }, versions: [{ hash: "hash", git: { commit: "commit", tree: "tree" } }] };
  const tools = [{ name: "internal", visibility: ["modules"], description: "Declared but not owner-callable" }];
  const system = { name: "modules", origin: "kernel", sessions: null, tools };
  const state = { fail: "" };
  const call = async (target: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push([target, args]);
    if (state.fail === target) throw new Error(`${target} unavailable`);
    switch (target) {
      case "modules.interfaces": return args.module ? args.module === "modules" ? system : { name: "files", tools } : [system];
      case "modules.list": return [app];
      case "modules.permissions": return { module: "files", capabilities: ["联网"] };
      case "modules.settings-get": return { declarations: { enabled: { type: "boolean", default: true } }, values: { enabled: true } };
      case "modules.diagnostics": return [{ moduleId: "app-id", incidents: [] }];
      case "notify.activity": return { items: [{ id: "activity", text: "设置已保存" }] };
      case "modules.build-sessions": return [{ id: "build-id", title: "构建", status: "idle" }];
      default: throw new Error(`Unexpected call ${target}`);
    }
  };
  return { call, calls, app, system, tools, state };
}
test("Web composes app details by name or id, preserving lifecycle/Git identity, settings and declared tools", async () => {
  for (const module of ["files", "app-id"]) {
    const f = fixture();
    expect(await appOverview(f.call, module)).toEqual({ kind: "app", app: f.app, tools: f.tools, permissions: { module: "files", capabilities: ["联网"] }, settings: { declarations: { enabled: { type: "boolean", default: true } }, values: { enabled: true } }, diagnostics: { moduleId: "app-id", incidents: [] }, activity: [{ id: "activity", text: "设置已保存" }] });
    expect(f.calls.slice(2).every(([, args]) => args.module === "files")).toBe(true);
    expect(f.calls).toContainEqual(["notify.activity", { module: "files", limit: 30 }]);
  }
});
test("Web composes only module build facts; directory remains metadata-only", async () => {
  const f = fixture();
  expect(await systemApps(f.call)).toEqual([f.system]);
  expect(f.calls).toEqual([["modules.interfaces", {}]]);
  expect(await appOverview(f.call, "modules")).toMatchObject({ kind: "system", name: "modules", sessions: "build", work: [{ id: "build-id", title: "构建" }], settings: { values: { enabled: true } }, activity: [{ text: "设置已保存" }] });
  expect(f.calls).toContainEqual(["modules.build-sessions", { limit: 20 }]);
  expect(f.calls.some(([target]) => target === "modules.permissions")).toBe(false);
});
test("unknown apps remain not_found; failed reads reject instead of replacing the UI's stale data", async () => {
  const f = fixture();
  await expect(appOverview(f.call, "missing")).rejects.toMatchObject({ code: "not_found" });
  for (const target of ["modules.interfaces", "modules.list", "modules.permissions", "modules.settings-get", "modules.diagnostics", "notify.activity"]) {
    f.state.fail = target;
    await expect(appOverview(f.call, "files")).rejects.toThrow(`${target} unavailable`);
  }
  f.state.fail = "modules.build-sessions";
  await expect(appOverview(f.call, "modules")).rejects.toThrow("modules.build-sessions unavailable");
});
test("system entries without conversations and empty activity/settings preserve empty states", async () => {
  const call = async (target: string, args: Record<string, unknown> = {}) => {
    if (target === "modules.interfaces") return args.module ? { name: "workspace-local", sessions: "legacy", tools: [], runtime: { status: "registered" } } : [{ name: "workspace-local", sessions: "legacy", tools: [], runtime: { status: "registered" } }];
    if (target === "modules.settings-get") return { declarations: {}, values: {} };
    if (target === "notify.activity") return { items: [] };
    throw new Error(`Unexpected call ${target}`);
  };
  expect(await appOverview(call, "workspace-local")).toMatchObject({ kind: "system", runtime: { status: "registered" }, settings: { declarations: {}, values: {} }, activity: [], sessions: null, work: [] });
});
