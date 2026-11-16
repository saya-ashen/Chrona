import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "./agent-application.fixtures";
import { callSync, kernelOrigin } from "../../packages/engine/src/modules/steward/modules/module-calls";
import { pageErrors } from "../../packages/engine/src/modules/steward/applications/web/pages";
import { manifest } from "../../packages/engine/src/modules/steward/applications/pi/build";
import { SETTINGS_PAGE, settingsRegistration } from "../../packages/engine/src/modules/steward/applications/pi/settings-page";
import type { ConfigurationView as SettingsView } from "../../packages/engine/src/modules/steward/applications/pi/configuration";

const parsed = moduleManifestSchema.parse(manifest());
test("Pi settings page validates against its actual generated tools", () => {
  expect(pageErrors(SETTINGS_PAGE)).toEqual([]);
  expect(parsed.uses).toContain("web.page-set");
  expect(parsed.activated).toBe(true);
  expect(parsed.tools.find(tool => tool.name === "configure")!.visibility).toEqual(["owner"]);
});

test("Pi retries unavailable Web without failing activation and stops after registration", async () => {
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

test("actual Web owner call saves Pi form through configure's live callback; revoked callers cannot write", async () => {
  const f = await agentFixture();
  const owner = { ...kernelOrigin(f.workspaceId), caller: { kind: "owner" as const, via: null } };
  try {
    const web = await f.ports.db.module.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "web" } });
    const hash = "settings-web", source = join(f.ports.dataDir, "platform/store", hash);
    await mkdir(source);
    await writeFile(join(source, "index.ts"), "import {chrona,on} from 'chrona'; on('tool', async t=>({result:await chrona.call({moduleId:chrona.dependencies.pi,tool:'configure'},t.args)}));");
    const configure = parsed.tools.find(tool => tool.name === "configure")!;
    const webManifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["*"], tools: [{ ...configure, name: "pi-settings" }],
        authority: "owner"
    });
    await f.ports.db.module.update({ where: { id: web.id }, data: { builtin: false, activeHash: hash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: web.id, hash, manifest: webManifest, source: "user", status: "approved", intent: {}, report: {} } });
    await callSync(f.ports, owner, "pi.configure", { config: { model: "fixture/custom", thinking: "low" } });
    const view = (await callSync(f.ports, owner, "web.pi-settings", { view: true })).output as SettingsView;
    expect(view.form).toEqual({ profile: "", model: "fixture/custom", thinking: "low" });
    const form = { profile: "", model: "fixture/balanced", thinking: "high" };
    const saved = (await callSync(f.ports, owner, "web.pi-settings", { form, view: true })).output as SettingsView;
    expect(saved.config).toEqual({ model: "fixture/balanced", thinking: "high" });
    for (const invalid of [{ ...form, profile: "relative" }, { ...form, model: "https://credential.invalid" }, { ...form, thinking: "invalid" }]) {
      await expect(callSync(f.ports, owner, "web.pi-settings", { form: invalid })).rejects.toBeTruthy();
    }
    expect((await callSync(f.ports, owner, "pi.configure", { view: true })).output).toEqual(saved);
    const origin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: "web", moduleId: web.id, hash } };
    await f.ports.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: web.id, hash } }, data: { manifest: { ...webManifest, authority: undefined, uses: ["pi.configure"] } } });
    await expect(callSync(f.ports, origin, "pi.configure", { form })).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);
