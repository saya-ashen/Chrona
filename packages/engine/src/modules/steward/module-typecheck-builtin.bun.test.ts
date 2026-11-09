import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { buildAgentApplication } from "./builtin/agent/build";
import { moduleContext } from "./module-context";
import { registerSystemModules } from "./system-modules";
import { testDb } from "./test-db";
import { typecheckBuild, typecheckErrors } from "./module-typecheck";
import type { StewardPorts } from "./ports";

const integrations = resolve(import.meta.dir, "../../../../integrations/src/steward");
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  registerSystemModules();
  const db = testDb(), root = await mkdtemp(join(tmpdir(), "chrona-builtin-typecheck-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(root, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "packaged builtin typecheck" } });
  const ports = { db, dataDir: root, publicUrl: null, now: () => new Date(), moduleSdk: join(integrations, "module-sdk"), moduleTypecheck: join(integrations, "module-typecheck") } as StewardPorts;
  const agent = join(root, "agent");
  // The same source-plus-JS material the release builder ships, without the monorepo around it.
  await cp(join(import.meta.dir, "builtin/agent"), agent, { recursive: true });
  await buildAgentApplication(agent);
  const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(agent, "module.json"), "utf8")));
  const web = moduleManifestSchema.parse(JSON.parse(await readFile(join(import.meta.dir, "external/web/module.json"), "utf8")));
  return { root, agent, manifest, web, context: moduleContext(ports, workspace.id) };
}

test("packaged Agent remains checked against Web with its bundled host type dependencies", async () => {
  const f = await fixture(), runtime = await readFile(join(f.agent, "runtime.ts"), "utf8");
  const candidate = { moduleName: "web", manifest: f.web };
  const isolated = await typecheckBuild(f.context, f.agent, f.manifest, candidate);
  expect(isolated.status).toBe("failed");
  expect(isolated.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2307, message: expect.stringContaining("integrations/src/steward/pi-provider") })]));

  const checked = await typecheckBuild(f.context, f.agent, f.manifest, { ...candidate, builtinCaller: true });
  expect(typecheckErrors(checked)).toEqual([]);
  expect(checked.status).toBe("passed");
  expect(await readFile(join(f.agent, "runtime.ts"), "utf8")).toBe(runtime);
  expect(await Bun.file(join(f.root, "integrations/src/steward/pi-provider.ts")).exists()).toBe(false);
}, 60_000);

test("builtin material preserves host types, candidate compatibility and missing-import failures", async () => {
  const f = await fixture(), entry = join(f.agent, "index.ts"), original = await readFile(entry, "utf8");
  const caller = `${original}\nimport { chrona } from "chrona";\nconst registered: string = (await chrona.call("web.page-set", { id: "probe", title: "Probe", spec: {} })).id;\nvoid registered;\n`;
  await writeFile(entry, caller);
  const candidate = { moduleName: "web", manifest: f.web, builtinCaller: true };
  const good = await typecheckBuild(f.context, f.agent, f.manifest, candidate);
  expect(typecheckErrors(good)).toEqual([]);
  expect(good.status).toBe("passed");

  const incompatible = moduleManifestSchema.parse({ ...f.web, tools: f.web.tools.map(tool => tool.name === "page-set" ? { ...tool, output: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false } } : tool) });
  const changed = await typecheckBuild(f.context, f.agent, f.manifest, { ...candidate, manifest: incompatible });
  expect(changed.status).toBe("failed");
  expect(changed.errors).toEqual(expect.arrayContaining([expect.objectContaining({ file: "index.ts", code: 2322 })]));

  await writeFile(entry, `${caller}\nimport { createPiProvider } from "../../../../../../integrations/src/steward/pi-provider";\ncreatePiProvider({ agentUrl: 123 });\n`);
  const invalid = await typecheckBuild(f.context, f.agent, f.manifest, candidate);
  expect(invalid.status).toBe("failed");
  expect(invalid.errors).toEqual(expect.arrayContaining([expect.objectContaining({ file: "index.ts", code: 2322 })]));
  // A value import ensures a missing caller dependency is always diagnosed by TypeScript.
  await writeFile(entry, `${caller}\nimport { missing } from "./missing-caller-dependency";\nvoid missing;\n`);
  const missing = await typecheckBuild(f.context, f.agent, f.manifest, candidate);
  expect(missing.status).toBe("failed");
  expect(missing.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2307, message: expect.stringContaining("missing-caller-dependency") })]));
}, 60_000);

test("compiled checker material works with no source tree at runtime", async () => {
  const f = await fixture(), harness = join(f.root, "check.ts"), binary = join(f.root, "check");
  await writeFile(harness, `
import { typecheckBuild } from ${JSON.stringify(join(import.meta.dir, "module-typecheck.ts"))};
import { moduleContext } from ${JSON.stringify(join(import.meta.dir, "module-context.ts"))};
const [agent, sdk, checker, webFile] = process.argv.slice(2);
const manifest = await Bun.file(agent + "/module.json").json();
const web = await Bun.file(webFile).json();
const ports = { db: { module: { findMany: async () => [] } }, dataDir: "/unused", now: () => new Date(), moduleSdk: sdk, moduleTypecheck: checker };
console.log(JSON.stringify(await typecheckBuild(moduleContext(ports as never, "fixture"), agent, manifest, { moduleName: "web", manifest: web, builtinCaller: true })));
`);
  // This is the /$bunfs case: macro source files must never be opened by the compiled binary.
  const built = await Bun.build({ entrypoints: [harness], target: "bun", compile: { outfile: binary } });
  expect(built.success).toBe(true);
  await rm(harness);
  const child = Bun.spawn([binary, f.agent, f.context.ports.moduleSdk!, f.context.ports.moduleTypecheck!, join(import.meta.dir, "external/web/module.json")], {
    cwd: f.root, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test", DATABASE_URL: process.env.DATABASE_URL!, CHRONA_DATA_DIR: f.root,
      CHRONA_MIGRATIONS_DIR: resolve(import.meta.dir, "../../../../../prisma/migrations") }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ status: "passed" });
}, 60_000);
