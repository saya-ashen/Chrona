import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileModuleOutput, moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../../../integrations/src/steward/script-sandbox";
import { createPages, pageErrors } from "../web/pages";
import { createPreferences } from "./preferences";
import { SETTINGS_PAGE } from "./page";
import { uiSettings } from "./ui-settings";

const app = "qq";
test(`${app} settings page validates and registers against real own tool schemas`, async () => {
  const root = await mkdtemp(`/tmp/chrona-${app}-settings-page-`);
  try {
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(import.meta.dirname, "module.json"), "utf8")));
    expect(manifest.activated).toBe(true);
    expect(manifest.uses).toContain("web.page-set");
    expect(manifest.tools.find(tool => tool.name === "ui-settings")?.visibility).toEqual(["owner"]);
    const schemas = new Map(manifest.tools.map(tool => [tool.name, tool.parameters]));
    expect(pageErrors(SETTINGS_PAGE, schemas, app)).toEqual([]);
    const tools = new Map(manifest.tools.map(tool => [tool.name, { inputSchema: tool.parameters, moduleId: app }]));
    const pages = createPages({ dataDir: root, modules: async () => [{ id: app, name: app, activeHash: "approved", status: "active" }], tools: async () => tools });
    await pages.tool("page-set", SETTINGS_PAGE, { kind: "module", module: app, moduleId: app });
    const registered = await pages.list();
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ id: "settings", purpose: "settings", title: SETTINGS_PAGE.title });
    expect(await pages.get(app, "settings")).toMatchObject({ layout: "document", purpose: "settings" });
    const output = compileModuleOutput(manifest.tools.find(tool => tool.name === "ui-settings")!.output!);
    expect(output.safeParse(await uiSettings(createPreferences(root), {})).success).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test(`${app} scalar settings persist typed partial updates and recover after errors`, async () => {
  const root = await mkdtemp(`/tmp/chrona-${app}-settings-store-`);
  try {
    const store = createPreferences(join(root, "data"));
    expect(await uiSettings(store, {})).toEqual({ provider: "", autoRecall: true, autoRetain: true });
    await uiSettings(store, { provider: "memory-local", "auto-recall": false, "auto-retain": false });
    for (const patch of [{ provider: "../invalid" }, { provider: false }, { "auto-recall": "false" }, { "auto-retain": 0 }, { extra: true }]) await expect(uiSettings(store, patch)).rejects.toThrow();
    expect(await uiSettings(createPreferences(join(root, "data")), {})).toEqual({ provider: "memory-local", autoRecall: false, autoRetain: false });
    expect(await uiSettings(store, { provider: "" })).toEqual({ provider: "", autoRecall: false, autoRetain: false });
    expect(await store.read()).toEqual({ provider: null, autoRecall: false, autoRetain: false });
    const blocked = join(root, "blocked"); await writeFile(blocked, "not a directory");
    const failing = createPreferences(join(blocked, "data"));
    await expect(uiSettings(failing, { "auto-recall": false })).rejects.toThrow();
    await rm(blocked); await mkdir(blocked);
    expect(await uiSettings(failing, { "auto-retain": false })).toEqual({ provider: "", autoRecall: true, autoRetain: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("QQ current source passes its offline unconfigured SDK harness", async () => {
  const root = await mkdtemp("/tmp/chrona-qq-settings-sdk-");
  try {
    const code = join(root, "platform", "store", "qq");
    await mkdir(code, { recursive: true }); await cp(import.meta.dirname, code, { recursive: true });
    const dataDir = join(root, "data"), contentDir = join(root, "content"); await mkdir(dataDir); await mkdir(contentDir);
    const sandbox = createScriptSandbox({ dataDir: root, executionMode: "trusted-local" });
    const report = await sandbox.runModule({ codeDir: code, dataDir, contentDir, entry: "test.ts", input: { now: "2026-11-09T00:00:00Z", params: {} }, network: false, timeoutMs: 60_000, maxOutputBytes: 64 * 1024 });
    expect(report.status, JSON.stringify(report)).toBe("succeeded");
    expect(report.exitCode, JSON.stringify(report)).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 90_000);
