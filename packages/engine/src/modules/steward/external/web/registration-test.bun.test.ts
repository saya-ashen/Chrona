import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileModuleOutput, moduleManifestSchema } from "@chrona/contracts/steward";
import { createRegistrationTest } from "./registration-test";
import { pageToolNames } from "./pages";
import webManifest from "./module.json";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const definition = { name: "Player", javascript: "export default function mount(element, {props}) { element.textContent = props.title; }", props: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }, events: [], slots: [], tools: ["play"] };
async function app(body: string, options: { visibility?: string[]; register?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "chrona-registration-app-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "module.json"), JSON.stringify({ name: "music", entry: "index.ts", activated: true, params: { register: { type: "boolean", value: options.register ?? true } }, effects: [], uses: ["web.component-set", "web.page-set"], tests: ["test.ts"], tools: [{ name: "play", description: "Play a track", visibility: options.visibility ?? ["owner"], idempotent: true, parameters: { type: "object", properties: {}, required: [] }, output: { type: "object", properties: { playing: { type: "boolean" } }, required: ["playing"], additionalProperties: false } }] }));
  await writeFile(join(root, "index.ts"), `import { chrona, on } from 'chrona';
    on('activated', async event => { ${body} });`);
  const harness = await createRegistrationTest(join(root, "index.ts"));
  cleanups.push(harness.close);
  return harness;
}
const register = `const component = await chrona.call('web.component-set', ${JSON.stringify(definition)});`;
const page = (type: string) => `await chrona.call('web.page-set', {id:'player', title:'Player', spec:{root:'player', elements:{player:{type:${type}, props:{title:'Track'}, children:[]}}}});`;

test.each(["app:Player", "music:Missing", "other:Player"])("real activation rejects unknown custom type %s with actionable bounded diagnostics", async type => {
  const h = await app(register + page(JSON.stringify(type)));
  let error: unknown;
  try { await h.activate(); } catch (cause) { error = cause; }
  // Web currently loses plain registration Error codes at its SDK boundary.
  expect(error).toMatchObject({ name: "ModelError", code: "failed" });
  const message = (error as Error).message;
  expect(message).toContain(type);
  expect(message).toContain("web.component-set");
  expect(message).toContain("返回的 type");
  expect(message).toContain("music:");
  expect(message.length).toBeLessThan(300);
  expect(message).not.toContain("Invalid option");
  expect(h.calls.map(call => call.target)).toEqual(["web.component-set", "web.page-set"]);
  expect(h.calls[0]!.result).toMatchObject({ name: "Player", type: "music:Player" });
  expect(await h.pages.list()).toEqual([]);
  expect(await h.pages.get("music", "player")).toBeNull();
});

test("real activation registers with returned type, preserving component revision and caller/tool pins", async () => {
  const h = await app(register + page("component.type"));
  await h.activate();
  const registered = h.calls[0]!.result as { name: string; type: string; revision: string };
  expect(registered).toEqual({ name: "Player", type: "music:Player", revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
  const saved = await h.pages.get("music", "player");
  expect(saved).toMatchObject({ moduleId: h.caller.moduleId, hash: h.caller.hash, spec: { elements: { player: { type: registered.type } } }, extensions: { [registered.type]: { revision: registered.revision, tools: ["play"] } } });
  expect(await h.pages.component("music", registered.name, registered.revision)).toMatchObject({ moduleId: h.caller.moduleId, hash: h.caller.hash, ...definition });
  await h.activate();
  expect(h.calls[2]!.result).toEqual(registered);
  expect(await h.pages.list()).toHaveLength(1);
});

test("registration harness enforces real Web input and output contracts", async () => {
  const h = await app(`await chrona.call('web.component-set', {...${JSON.stringify(definition)}, module:'other'});`);
  await expect(h.activate()).rejects.toMatchObject({ code: "invalid" });
  await expect(h.pages.component("music", "Player", "missing")).rejects.toMatchObject({ code: "not_found" });
  const manifest = moduleManifestSchema.parse(webManifest);
  const output = compileModuleOutput(manifest.tools.find(tool => tool.name === "component-set")!.output!);
  expect(output.safeParse({ name: "Player", revision: "revision" }).success).toBe(false);
  expect(output.safeParse({ name: "Player", type: "music:Player", revision: "revision" }).success).toBe(true);
});

test("registration harness mirrors Web's user-visible tool discovery", async () => {
  const h = await app(register + page("component.type"), { visibility: ["modules"] });
  await expect(h.activate()).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("play") });
  expect(await h.pages.list()).toEqual([]);
});

test("registration harness supplies the app's declared runtime parameters", async () => {
  for (const enabled of [false, true]) {
    const h = await app(`if (event.params.register) { ${register + page("component.type")} }`, { register: enabled });
    await h.activate();
    expect(await h.pages.list()).toHaveLength(enabled ? 1 : 0);
    expect(h.calls).toHaveLength(enabled ? 2 : 0);
  }
});

test("registration harness rejects unmocked SDK calls instead of silently proving activation", async () => {
  const h = await app("await chrona.call('music.play', {});");
  await expect(h.activate()).rejects.toThrow("Unmocked registration SDK call: music.play");
});

test("portable built helper runs an ordinary app's actual handler outside the checkout without dependencies", async () => {
  const buildRoot = await mkdtemp(join(tmpdir(), "chrona-registration-build-"));
  const candidate = await mkdtemp(join(tmpdir(), "chrona-standalone-player-"));
  cleanups.push(() => rm(buildRoot, { recursive: true, force: true }), () => rm(candidate, { recursive: true, force: true }));
  const build = Bun.spawn([process.execPath, "--no-install", "run", join(import.meta.dirname, "build.ts"), "--registration-test-only", buildRoot], { stdout: "pipe", stderr: "pipe" });
  const [buildCode, buildOut, buildError] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
  expect(buildCode, buildOut + buildError).toBe(0);
  await copyFile(join(buildRoot, "registration-test.mjs"), join(candidate, "registration-test.mjs"));
  // Removing the original proves that a copied single file has no build-directory dependencies.
  await rm(buildRoot, { recursive: true, force: true });
  for (const [name, type] of [["placeholder", "'app:Player'"], ["returned", "component.type"]]) {
    const dir = join(candidate, name!);
    const entryDir = name === "returned" ? join(dir, "src") : dir;
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(dir, "module.json"), JSON.stringify({ name: "local-player", entry: name === "returned" ? { path: "src/index.ts", runtime: "bun" } : "index.ts", activated: true, keepAlive: true, effects: [], uses: ["web.component-set", "web.page-set"], tests: ["test.ts"], tools: [] }));
    await writeFile(join(entryDir, "index.ts"), `import { chrona, on } from 'chrona';
      import { readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { filename } from './player';
      on('activated', async () => {
        const javascript = await readFile(join(chrona.paths.module, filename), 'utf8');
        const component = await chrona.call('web.component-set', {name:'Player', javascript, props:{type:'object', properties:{}, additionalProperties:false}});
        await chrona.call('web.page-set', {id:'player', title:'播放器', spec:{root:'player', elements:{player:{type:${type}, props:{}, children:[]}}}});
      });`);
    await writeFile(join(dir, "test.ts"), "import '../registration.bun.test';");
    await writeFile(join(entryDir, "player.ts"), "export const filename = 'player.js';");
    await writeFile(join(dir, "player.js"), 'export default function mount(element) { element.textContent = "播放器"; }');
  }
  // This is also the exact consumer pattern documented for ordinary application workspaces.
  await writeFile(join(candidate, "registration.bun.test.ts"), `import { expect, test } from 'bun:test';
    import { createRegistrationTest } from './registration-test.mjs';
    import { join } from 'node:path';
    test('placeholder is rejected by real Web validators', async () => {
      const h = await createRegistrationTest(join(import.meta.dirname, 'placeholder/index.ts'));
      try {
        await expect(h.activate()).rejects.toThrow('app:Player');
        expect(h.calls[0].result.type).toBe('local-player:Player');
        expect(h.calls[1].error.message).toContain('web.component-set');
        expect(await h.pages.list()).toHaveLength(0);
      } finally { await h.close(); }
    });
    test('returned type registers and stores the actual app page', async () => {
      const h = await createRegistrationTest(join(import.meta.dirname, 'returned/src/index.ts'), {manifest:join(import.meta.dirname, 'returned/module.json')});
      try {
        await h.activate();
        const component = h.calls.find(call => call.target === 'web.component-set').result;
        expect(component.type).toBe('local-player:Player');
        expect(await h.pages.get('local-player', 'player')).toMatchObject({moduleId:h.caller.moduleId, hash:h.caller.hash, spec:{elements:{player:{type:component.type}}}, extensions:{[component.type]:{revision:component.revision}}});
        expect(await h.pages.component('local-player', 'Player', component.revision)).toMatchObject({name:'Player', hash:h.caller.hash});
      } finally { await h.close(); }
    });`);
  // No SDK, DATABASE_URL, monorepo aliases, preload, node_modules or package installation.
  const child = Bun.spawn([process.execPath, "--no-install", "test", "./registration.bun.test.ts"], {
    cwd: candidate, stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env.PATH, TMPDIR: candidate, BUN_INSTALL_CACHE_DIR: join(candidate, "empty-cache"), NODE_OPTIONS: "--max-old-space-size=2048" },
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, stdout + stderr).toBe(0);
  expect(stderr).toContain("2 pass");
}, 60_000);

test("reusable harness executes the existing Coding Web activated handler and validates its real tool contracts", async () => {
  const h = await createRegistrationTest(join(import.meta.dirname, "../coding-web/index.ts"));
  cleanups.push(h.close);
  await h.activate();
  expect(h.calls.map(call => call.target)).toEqual(["web.page-set"]);
  const pages = await h.pages.list();
  expect(pages).toHaveLength(1);
  const saved = await h.pages.get("coding-web", pages[0]!.id);
  expect(saved?.moduleId).toBe(h.caller.moduleId);
  expect(pageToolNames(saved!).length).toBeGreaterThan(0);
});
