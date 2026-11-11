import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createConfiguration } from "./configuration";
import { settingsRegistration, SETTINGS_PAGE } from "./settings-page";

const directories: string[] = [];
const inherited = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
afterEach(async () => {
  for (const [key, value] of Object.entries(inherited)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp("/tmp/chrona-pi-configuration-"); directories.push(root);
  const profile = join(root, "profile"), data = join(root, "data"); await mkdir(profile, { mode: 0o700 });
  await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "first", defaultThinkingLevel: "medium", credential: "private-settings-value" }));
  const options = { chronaExtension: "/host/extension.ts", agentUrl: "http://host/runtime", command: "/host/pi", agentDir: profile, nativeTimeoutMs: 1234 };
  return { root, profile, data, options, configuration: createConfiguration(data, options) };
}
test("profile defaults, host values, owner overrides and clear have explicit precedence", async () => {
  const f = await setup();
  expect(await f.configuration.configure({ view: true })).toMatchObject({ config: {}, effective: { profile: f.profile, profileSource: "host.agentDir", model: "local/first", modelSource: "profile", thinking: "medium", thinkingSource: "profile" } });
  const hosted = createConfiguration(f.data, { ...f.options, model: "host/model", thinking: "high" });
  const before = await hosted.snapshot(); expect(before.options).toMatchObject({ model: "host/model", thinking: "high", nativeTimeoutMs: 1234 });
  const changed = await hosted.configure({ form: { profile: "", model: "owner/model", thinking: "off" } });
  expect(changed.effective).toMatchObject({ model: "owner/model", modelSource: "configuration", thinking: "off", thinkingSource: "configuration" });
  expect(changed.revision).not.toBe(before.revision);
  expect((await createConfiguration(f.data, f.options).snapshot()).options).toMatchObject({ model: "owner/model", thinking: "off" });
  expect(await hosted.configure({ clear: true })).toMatchObject({ config: {}, form: { profile: "", model: "", thinking: "" }, effective: { model: "host/model", thinking: "high" } });
  const persisted = await readFile(join(f.data, "configuration.json"), "utf8");
  expect(persisted).not.toContain("private-settings-value"); expect(persisted).not.toContain("agentUrl");
  if (process.platform !== "win32") expect((await stat(join(f.data, "configuration.json"))).mode & 0o077).toBe(0);
});
test("normal current-user default remains implicit so Pi may create it on first use", async () => {
  const f = await setup(); delete process.env.PI_CODING_AGENT_DIR; process.env.HOME = f.root;
  const config = createConfiguration(f.data, { ...f.options, agentDir: undefined });
  const snapshot = await config.snapshot();
  expect(snapshot.effective).toMatchObject({ profile: join(f.root, ".pi", "agent"), profileSource: "default.HOME/.pi/agent", profileStatus: "unavailable" });
  expect(snapshot.options.agentDir).toBeUndefined();
  process.env.PI_CODING_AGENT_DIR = f.profile;
  expect((await config.snapshot()).options.agentDir).toBe(f.profile);
  expect((await config.configure({})).effective.profileSource).toBe("env.PI_CODING_AGENT_DIR");
});
test("local model options expose only validated IDs; unsafe paths and files are rejected", async () => {
  const f = await setup();
  await writeFile(join(f.profile, "models.json"), JSON.stringify({ providers: { custom: { apiKey: "private-models-value", baseUrl: "https://private.invalid", models: [{ id: "second", name: "private-label" }, { id: "https://credential.invalid" }, { id: "second" }] } } }));
  await writeFile(join(f.profile, "auth.json"), "not-readable-by-discovery");
  const models = await f.configuration.models();
  expect(models.items.map(item => item.id)).toEqual(["custom/second", "local/first"]);
  expect(JSON.stringify(models)).not.toContain("private-");
  const link = join(f.root, "profile-link"); await symlink(f.profile, link);
  await expect(f.configuration.configure({ config: { profile: link } })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.configuration.configure({ config: { profile: "relative" } })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.configuration.configure({ config: { model: "https://secret.invalid/key" } })).rejects.toMatchObject({ code: "invalid" });
  await rm(join(f.profile, "models.json")); await symlink(join(f.profile, "auth.json"), join(f.profile, "models.json"));
  const unsafe = await f.configuration.models(); expect(unsafe.items.map(item => item.id)).toEqual(["local/first"]); expect(unsafe.warnings).toHaveLength(1);
  expect(JSON.stringify(unsafe)).not.toContain("not-readable-by-discovery");
  await rm(join(f.profile, "models.json")); await writeFile(join(f.profile, "models.json"), "x".repeat(1024 * 1024 + 1));
  expect((await f.configuration.models()).warnings).toHaveLength(1);
});
test("persisted corruption is explicit and does not silently restore defaults", async () => {
  const f = await setup(); await f.configuration.configure({ config: { model: "owner/model" } });
  await writeFile(join(f.data, "configuration.json"), '{"config":{"model":"tampered/model"},"revision":"bad"}');
  await expect(f.configuration.snapshot()).rejects.toMatchObject({ code: "invalid" });
});
test("settings page registers ordinary owner tools and retries rejected registration", async () => {
  const attempts: unknown[] = []; const registration = settingsRegistration(async (target, args) => { attempts.push({ target, args }); return attempts.length === 1 ? { error: "not ready" } : {}; });
  await registration.refresh(); expect(attempts).toHaveLength(0);
  await registration.activate(); await registration.refresh(); await registration.refresh();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual({ target: "web.page-set", args: SETTINGS_PAGE });
  expect(SETTINGS_PAGE.data.policy.tool).toBe("configure"); expect(SETTINGS_PAGE.data.models.tool).toBe("models");
  expect(JSON.stringify(SETTINGS_PAGE)).not.toMatch(/fast|balanced|deep|tier/);
  expect(SETTINGS_PAGE.spec.elements.failed.props).toMatchObject({ title: "保存失败" });
});
test("advertised revision archives survive settings changes, source mutations and restart without secrets", async () => {
  const f = await setup(), original = await f.configuration.archive();
  await f.configuration.configure({ config: { model: "changed/model", thinking: "max" } });
  const changed = await f.configuration.archive();
  expect(changed.revision).not.toBe(original.revision);
  await writeFile(join(f.profile, "settings.json"), JSON.stringify({ defaultProvider: "later", defaultModel: "model", defaultThinkingLevel: "off" }));
  const restarted = createConfiguration(f.data, f.options);
  expect((await restarted.snapshot(original.revision)).options).toMatchObject({ agentDir: f.profile, model: "local/first", thinking: "medium" });
  expect((await restarted.snapshot(changed.revision)).options).toMatchObject({ model: "changed/model", thinking: "max" });
  await expect(restarted.snapshot("f".repeat(64))).rejects.toMatchObject({ code: "unavailable" });
  const path = join(f.data, "configuration-revisions", `${original.revision}.json`), archive = await readFile(path, "utf8");
  expect(archive).not.toContain("private-settings-value"); expect(archive).not.toContain("agentUrl"); expect(archive).not.toContain("extension.ts");
  if (process.platform !== "win32") expect((await stat(path)).mode & 0o077).toBe(0);
  await writeFile(path, archive.replace("local/first", "tampered/model"));
  await expect(restarted.snapshot(original.revision)).rejects.toMatchObject({ code: "unavailable" });
});
