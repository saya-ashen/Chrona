import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "../../agent-application.fixtures";
import { callSync, kernelOrigin } from "../../module-calls";
import { normalizedToolInputSchema } from "../../module-tool-contract";
import { pageErrors } from "../../external/web/pages";
import manifest from "./module.json";
import { SETTINGS_PAGE, settingsRegistration } from "./settings-page";
import type { ModelPolicy } from "./model-policy";
type SettingsView = Awaited<ReturnType<ModelPolicy["configure"]>>;

const parsed = moduleManifestSchema.parse(manifest);
test("Agent settings page validates against its actual generated tools", () => {
  const tools = new Map(parsed.tools.map(tool => [tool.name, normalizedToolInputSchema(tool)]));
  expect(pageErrors(SETTINGS_PAGE, tools, "agent")).toEqual([]);
  expect(parsed.uses).toContain("web.page-set");
  expect(parsed.activated).toBe(true);
  expect(parsed.tools.find(tool => tool.name === "configure")!.visibility).toEqual(["owner"]);
});

test("Agent retries unavailable Web without failing activation and stops after registration", async () => {
  let attempts = 0;
  const registration = settingsRegistration(async (target, args) => {
    expect(target).toBe("web.page-set"); expect(args).toBe(SETTINGS_PAGE);
    if (++attempts === 1) throw new Error("Web unavailable");
    return { ok: true };
  });
  await registration.refresh(); expect(attempts).toBe(0);
  await registration.activate(); expect(attempts).toBe(1);
  await registration.refresh(); await registration.refresh(); expect(attempts).toBe(2);
});

test("actual Web owner call saves Agent form through configure's live callback; revoked callers cannot write", async () => {
  const f = await agentFixture();
  const owner = { ...kernelOrigin(f.workspaceId), caller: { kind: "owner" as const, via: null } };
  try {
    const web = await f.ports.db.module.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "web" } });
    const hash = "settings-web", source = join(f.ports.dataDir, "platform/store", hash);
    await mkdir(source);
    await writeFile(join(source, "index.ts"), "import {chrona,on} from 'chrona'; on('tool', async t=>({result:await chrona.call('agent.configure',t.args)}));");
    const configure = parsed.tools.find(tool => tool.name === "configure")!;
    const webManifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["*"], tools: [{ ...configure, name: "agent-settings" }] });
    await f.ports.db.module.update({ where: { id: web.id }, data: { builtin: false, activeHash: hash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: web.id, hash, manifest: webManifest, source: "user", status: "approved", intent: {}, report: {} } });
    await callSync(f.ports, owner, "agent.configure", { config: { tiers: { "deep-work": { model: "fixture/custom" } }, "preferred-timeout-ms": 1000 } });
    const view = (await callSync(f.ports, owner, "web.agent-settings", { view: true })).output as SettingsView;
    const draft = view.form!;
    expect(draft.tiers).toEqual({ fast: { model: "", thinking: "" }, balanced: { model: "", thinking: "" }, deep: { model: "", thinking: "" } });
    draft.tiers.fast = { model: "fixture/fast", thinking: "low" };
    draft.tiers.balanced = { model: "fixture/balanced", thinking: "medium" };
    draft.tiers.deep = { model: "fixture/deep", thinking: "high" };
    draft.preferredTimeoutMs = "2500";
    // The page binds camelCase output state to kebab-case routed input fields.
    const form = { tiers: draft.tiers, "preferred-timeout-ms": draft.preferredTimeoutMs };
    const saved = (await callSync(f.ports, owner, "web.agent-settings", { form, view: true })).output as SettingsView;
    expect(saved.config).toEqual({ tiers: {
      fast: { model: "fixture/fast", thinking: "low" }, balanced: { model: "fixture/balanced", thinking: "medium" }, deep: { model: "fixture/deep", thinking: "high" },
      "deep-work": { model: "fixture/custom" },
    }, preferredTimeoutMs: 2500 });
    for (const timeout of ["", "0", "600001", "1.5", "NaN"]) {
      await expect(callSync(f.ports, owner, "web.agent-settings", { form: { ...form, "preferred-timeout-ms": timeout } })).rejects.toBeTruthy();
    }
    expect((await callSync(f.ports, owner, "agent.configure", { view: true })).output).toEqual(saved);
    const origin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: "web", moduleId: web.id, hash } };
    await f.ports.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: web.id, hash } }, data: { manifest: { ...webManifest, uses: ["agent.configure"] } } });
    await expect(callSync(f.ports, origin, "agent.configure", { form })).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);
