import { expect, test } from "bun:test";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { agentFixture } from "../../../../../../../scripts/agent-integration/agent-application.fixtures";
import { callSync, kernelOrigin } from "../../module-calls";
import { pageErrors } from "../web/pages";
import manifest from "./module.json";
import { SETTINGS_PAGE, settingsRegistration, type settingsForm } from "./settings-page";
import type { Settings } from "./budget";
type SettingsView = { settings: Settings; form: ReturnType<typeof settingsForm> };

const parsed = moduleManifestSchema.parse(manifest);
test("Notify settings page validates against its real owner tools", () => {
  expect(pageErrors(SETTINGS_PAGE)).toEqual([]);
  expect(parsed.uses).toContain("web.page-set");
  expect(parsed.activated).toBe(true);
  for (const name of ["settings", "ui-settings", "counts"]) expect(parsed.tools.find(tool => tool.name === name)!.visibility).toEqual(["owner"]);
  const counts = parsed.tools.find(tool => tool.name === "counts")!;
  expect(counts.idempotent).toBe(true);
  expect(counts.sideEffects).toEqual([]);
  expect(counts.parameters).toEqual({ type: "object", properties: {}, required: [] });
  expect(counts.output).toEqual({ type: "object", properties: { queued: { type: "integer" }, failed: { type: "integer" } }, required: ["queued", "failed"], additionalProperties: false });
});
test("Notify registration survives unavailable Web and retries rejected registrations", async () => {
  let attempts = 0;
  const registration = settingsRegistration(async () => {
    attempts++;
    if (attempts === 1) throw new Error("Web unavailable");
    return attempts === 2 ? { error: "unavailable" } : { ok: true };
  });
  await registration.activate(); await registration.refresh(); await registration.refresh(); await registration.refresh();
  expect(attempts).toBe(3);
});

test("routed Web owner reads and saves Notify form, rejects invalid inputs, and retains owner guards", async () => {
  const f = await agentFixture();
  const owner = { ...kernelOrigin(f.workspaceId), caller: { kind: "owner" as const, via: null } };
  try {
    const notify = await f.ports.db.module.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "notify" } });
    const hash = "notify-settings", source = join(f.ports.dataDir, "platform/store", hash);
    await cp(import.meta.dir, source, { recursive: true });
    await f.ports.db.module.update({ where: { id: notify.id }, data: { builtin: false, activeHash: hash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: notify.id, hash, manifest: parsed, source: "user", status: "approved", intent: {}, report: {} } });
    const web = await f.ports.db.module.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "web" } });
    const webHash = "notify-settings-web", webSource = join(f.ports.dataDir, "platform/store", webHash);
    await mkdir(webSource);
    await writeFile(join(webSource, "index.ts"), "import {chrona,on} from 'chrona'; on('tool', async t=>({result:await chrona.call({moduleId:chrona.dependencies.notify,tool:'ui-settings'},t.args)}));");
    const adapter = parsed.tools.find(tool => tool.name === "ui-settings")!;
    const webManifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["*"], tools: [{ ...adapter, name: "notify-settings" }],
        authority: "owner"
    });
    await f.ports.db.module.update({ where: { id: web.id }, data: { builtin: false, activeHash: webHash } });
    await f.ports.db.moduleVersion.create({ data: { moduleId: web.id, hash: webHash, manifest: webManifest, source: "user", status: "approved", intent: {}, report: {} } });
    const view = (await callSync(f.ports, owner, "web.notify-settings", {})).output as SettingsView;
    expect(view.form).toEqual({ "daily-cap": "5", timezone: "Asia/Shanghai", "digest-at": "09:00", "quiet-start": "23:00", "quiet-end": "08:00" });
    const form = { ...view.form, "daily-cap": "0", timezone: "UTC", "digest-at": "10:30", "quiet-start": "", "quiet-end": "" };
    const saved = (await callSync(f.ports, owner, "web.notify-settings", { form })).output as SettingsView;
    expect(saved.settings).toEqual({ dailyCap: 0, timezone: "UTC", digestAt: "10:30", quietHours: null });
    for (const invalid of [{ "daily-cap": "" }, { "daily-cap": "1.5" }, { "daily-cap": "51" }, { timezone: "invalid/timezone" }, { "digest-at": "25:00" }, { "quiet-start": "22:00" }]) {
      expect((await callSync(f.ports, owner, "web.notify-settings", { form: { ...form, ...invalid } })).output).toMatchObject({ error: "invalid" });
    }
    expect((await callSync(f.ports, owner, "notify.ui-settings", {})).output).toEqual(saved);
    expect((await callSync(f.ports, owner, "notify.settings", {})).output).toEqual({ settings: saved.settings });
    const origin = { ...kernelOrigin(f.workspaceId), caller: { kind: "module" as const, module: "web", moduleId: web.id, hash: webHash } };
    await f.ports.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: web.id, hash: webHash } }, data: { manifest: { ...webManifest, authority: undefined, uses: ["notify.ui-settings", "notify.settings"] } } });
    for (const tool of ["ui-settings", "settings"]) await expect(callSync(f.ports, origin, `notify.${tool}`, {})).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.ports.db.moduleCall.count({ where: { method: "model" } })).toBe(0);
  } finally { await f.close(); }
}, 30000);
