import { expect, test } from "bun:test";
import { appOverview, systemApps } from "./app-overview";

type Row = Record<string, unknown>;
function contract(target: string, identity: Row = {}) {
  return { target, description: `Contract for ${target}`, inputSchema: { type: "object", properties: {} }, outputSchema: null,
    examples: null, sideEffects: null, errors: null, retry: "Unknown outcomes are not redelivered.", idempotent: false, ...identity };
}
function fixture() {
  const calls: [string, Row][] = [];
  const app = { id: "app-id", name: "files", origin: "external", status: "active", activeHash: "hash",
    capabilities: { update: true, remove: true }, health: { runtime: { state: "unobserved", pid: null } },
    versions: [{ hash: "hash", git: { commit: "commit", tree: "tree" } }] };
  const appTool = contract("files.read", { moduleId: app.id, hash: "hash" });
  const diagnostic = { module: app.name, moduleId: app.id, runtime: { state: "unobserved", pid: null }, incidents: [], truncated: true };
  const state = {
    fail: "", apps: [app], tools: [contract("modules.list"), contract("modules.describe"), appTool, contract("notify.activity", { moduleId: "notify-id" })],
    diagnostics: [diagnostic], activity: [{ id: "activity", text: "模块记录" }],
  };
  const call = async (target: string, args: Row = {}): Promise<unknown> => {
    calls.push([target, args]);
    if (state.fail === target) throw new Error(`${target} unavailable`);
    switch (target) {
      case "modules.describe": return { items: state.tools, nextCursor: null };
      case "modules.list": return { items: state.apps, nextCursor: null };
      case "modules.health": return { items: state.diagnostics, nextCursor: null };
      case "notify.activity": return { items: state.activity };
      default: throw new Error(`Unexpected call ${target}`);
    }
  };
  return { call, calls, app, appTool, diagnostic, state };
}

test("app details resolve names and ids and preserve lifecycle, Git and discovered contract metadata", async () => {
  for (const module of ["files", "app-id"]) {
    const f = fixture();
    // Discovery searches descriptions too; only this exact application's targets belong here.
    f.state.tools.push(contract("files-extra.read", { moduleId: "other-id", description: "files" }), contract("other.read", { moduleId: f.app.id }), contract("files.old", { moduleId: "old-id" }));
    expect(await appOverview(f.call, module)).toEqual({ kind: "app", app: f.app, tools: [f.appTool], diagnostics: f.diagnostic, activity: f.state.activity });
    expect(f.calls).toEqual([
      ["modules.describe", {}], ["modules.list", {}], ["modules.health", { moduleId: "app-id", detail: true }], ["notify.activity", { module: "files", limit: 30 }],
    ]);
  }
});

test("kernel directory groups only the known kernel namespaces from actual reachable contracts", async () => {
  const f = fixture();
  const names = ["agent", "approvals", "modules", "settings", "secrets", "activity", "timers"];
  const kernelTools = names.map(name => contract(`${name}.read`));
  f.state.tools = [...kernelTools, f.appTool, ...["notify", "author", "web", "events", "workspace-local", "content-local", "runtime-callback", "modules-extra"].map(name => contract(`${name}.read`)), contract("settings.app-tool", { moduleId: "ordinary-id" })];
  const directory = await systemApps(f.call);
  expect(directory).toEqual(names.map((name, index) => ({ name, origin: "kernel", description: expect.any(String), tools: [kernelTools[index]] })));
  expect(f.calls).toEqual([["modules.describe", {}]]);
  if (!Array.isArray(directory)) throw new Error("Expected a kernel directory");
  const modules = directory.find(entry => entry.name === "modules")!;
  expect(await systemApps(f.call, "modules")).toEqual(modules);
  const overview = await appOverview(f.call, "modules");
  expect(overview).toEqual({ kind: "system", ...modules, activity: null });
  expect(f.calls.every(([target]) => target === "modules.describe")).toBe(true);
});

test("kernel metadata cannot be inferred from ordinary apps or absent contracts", async () => {
  const f = fixture();
  f.state.tools = [contract("settings.read", { moduleId: "ordinary-id" }), contract("agent.run", { moduleId: "agent-id" })];
  expect(await systemApps(f.call)).toEqual([]);
  for (const name of ["settings", "modules", "agent", "workspace-local"]) {
    await expect(systemApps(f.call, name)).rejects.toMatchObject({ code: "not_found" });
  }
  await expect(appOverview(f.call, "settings")).rejects.toMatchObject({ code: "not_found" });
});

test("Agent, Web, Notify and Author remain ordinary app overviews", async () => {
  for (const name of ["agent", "web", "notify", "author"]) {
    const f = fixture();
    f.app.name = name;
    f.state.tools = [contract(`${name}.read`, { moduleId: f.app.id })];
    expect(await appOverview(f.call, name)).toMatchObject({ kind: "app", app: { id: f.app.id, name }, tools: f.state.tools, activity: null });
  }
});

test("undiscovered activity is null; successful empty reads preserve empty states", async () => {
  for (const available of [false, true]) {
    const f = fixture();
    f.state.tools = available ? [contract("notify.activity", { moduleId: "notify-id" })] : [contract("notify.activity-more", { moduleId: "notify-id" }), contract("other.read", { description: "notify.activity" })];
    f.state.diagnostics = [];
    f.state.activity = [];
    expect(await appOverview(f.call, "files")).toEqual({ kind: "app", app: f.app, tools: [], diagnostics: null, activity: available ? [] : null });
    expect(f.calls.some(([target]) => target === "notify.activity")).toBe(available);
  }
});

test("kernel activity is read only when its exact tool is discovered", async () => {
  const f = fixture();
  expect(await appOverview(f.call, "modules")).toMatchObject({ kind: "system", name: "modules", activity: f.state.activity });
  expect(f.calls).toEqual([["modules.describe", {}], ["notify.activity", { module: "modules", limit: 30 }]]);
});

test("unrelated diagnostic rows are never attributed to the requested app", async () => {
  const f = fixture();
  f.state.diagnostics = [{ ...f.diagnostic, module: "other", moduleId: "other-id" }];
  expect(await appOverview(f.call, "files")).toMatchObject({ diagnostics: null });
});

test("unknown apps are not_found without diagnostics or activity reads", async () => {
  const f = fixture();
  await expect(appOverview(f.call, "missing")).rejects.toMatchObject({ code: "not_found" });
  expect(f.calls).toEqual([["modules.describe", {}], ["modules.list", {}]]);
});

test("failed discovery and discovered reads reject instead of reporting empty or missing data", async () => {
  for (const target of ["modules.describe", "modules.list", "modules.health", "notify.activity"]) {
    const f = fixture();
    f.state.fail = target;
    await expect(appOverview(f.call, "files")).rejects.toThrow(`${target} unavailable`);
  }
  for (const target of ["modules.describe", "notify.activity"]) {
    const f = fixture();
    f.state.fail = target;
    await expect(appOverview(f.call, "modules")).rejects.toThrow(`${target} unavailable`);
  }
  const f = fixture();
  f.state.fail = "modules.describe";
  await expect(systemApps(f.call)).rejects.toThrow("modules.describe unavailable");
});
