import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { accessSync, constants } from "node:fs";
import { processHelperPath } from "../../../../integrations/src/steward/module-runtime";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { assembleModuleDependencies } from "../../../../../build/agent-dependencies";
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
  const db = testDb({ injectedAgent: false }), root = await mkdtemp(join(tmpdir(), "chrona-pi-dependencies-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(root, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "ordinary Pi dependencies" } });
  const moduleRuntimes = await Bun.file(join(integrations, "runtimes.json")).json();
  const ports = { db, dataDir: root, publicUrl: null, now: () => new Date(), moduleRuntimes, moduleSdk: join(integrations, "module-sdk"), moduleTypecheck: join(integrations, "module-typecheck") } as StewardPorts;
  const pi = join(root, "pi");
  await cp(join(import.meta.dir, "external/pi"), pi, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ["node_modules", "vendor"].includes(part)) });
  await assembleModuleDependencies(pi);
  const lock = await readFile(join(pi, "bun.lock"), "utf8");
  expect(lock).not.toMatch(/https?:|workspace:/);
  const pkg = await Bun.file(join(pi, "package.json")).json() as { dependencies: Record<string, string> };
  expect(Object.keys(pkg.dependencies).sort()).toEqual(["@chrona/contracts", "@chrona/logging", "@chrona/pi", "zod"]);
  // Assemble the real runtime/declaration graph, then link only its local closure.
  // No package installer or registry/cache access is needed by this detached fixture.
  for (const [name, source] of Object.entries(pkg.dependencies)) {
    expect(source).toBe(`file:vendor/${name}`);
    const vendor = join(pi, source.slice("file:".length));
    const dependency = await Bun.file(join(vendor, "package.json")).json() as { name: string; dependencies?: Record<string, string> };
    expect(dependency.name).toBe(name);
    for (const [child, target] of Object.entries(dependency.dependencies ?? {})) {
      expect(Object.hasOwn(pkg.dependencies, child)).toBe(true);
      expect(target.startsWith("file:")).toBe(true);
      expect(resolve(vendor, target.slice("file:".length))).toBe(join(pi, "vendor", child));
    }
    const link = join(pi, "node_modules", name);
    await mkdir(dirname(link), { recursive: true });
    await symlink(relative(dirname(link), vendor), link);
  }
  expect(await readFile(join(pi, "bun.lock"), "utf8")).toBe(lock);
  // Check the actual Pi source, not just its bundled JavaScript entrypoint.
  await writeFile(join(pi, "index.ts"), 'import "./runtime.ts";\n');
  const manifest = moduleManifestSchema.parse(await Bun.file(join(pi, "module.json")).json());
  const web = moduleManifestSchema.parse(await Bun.file(join(import.meta.dir, "external/web/module.json")).json());
  return { root, pi, manifest, web, moduleRuntimes, context: moduleContext(ports, workspace.id) };
}

test("detached Pi uses staged ordinary dependencies for candidate checking", async () => {
  const f = await fixture(), runtime = await readFile(join(f.pi, "runtime.ts"), "utf8");
  const checked = await typecheckBuild(f.context, f.pi, f.manifest, { moduleName: "web", manifest: f.web });
  expect(typecheckErrors(checked)).toEqual([]);
  expect(checked.status).toBe("passed");
  expect(await readFile(join(f.pi, "runtime.ts"), "utf8")).toBe(runtime);
  expect(await Bun.file(join(f.root, "packages/pi/src/pi-provider.ts")).exists()).toBe(false);
  const probe = Bun.spawn([process.execPath, "--no-install", "-e", `import { createPiProvider } from "@chrona/pi"; import { redactSensitiveText } from "@chrona/logging"; if (typeof createPiProvider !== "function" || typeof redactSensitiveText !== "function") process.exit(1); console.log(import.meta.resolve("@chrona/pi"));`], { cwd: f.pi, env: { PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain(f.pi);
}, 60_000);

test("ordinary Pi dependencies retain Pi options, missing imports and candidate output diagnostics", async () => {
  const f = await fixture(), entry = join(f.pi, "index.ts"), original = await readFile(entry, "utf8");
  const caller = `${original}\nimport { chrona, type ChronaCalls } from "chrona";\nconst registered: string = (await chrona.call<ChronaCalls["web.page-set"]["output"]>({ moduleId: chrona.dependencies.web!, tool: "page-set" }, { id: "probe", title: "Probe", spec: {} })).id;\nvoid registered;\n`;
  await writeFile(entry, caller);
  const candidate = { moduleName: "web", manifest: f.web };
  const good = await typecheckBuild(f.context, f.pi, f.manifest, candidate);
  expect(typecheckErrors(good)).toEqual([]);
  expect(good.status).toBe("passed");

  const incompatible = moduleManifestSchema.parse({ ...f.web, tools: f.web.tools.map(tool => tool.name === "page-set" ? { ...tool, output: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false } } : tool) });
  const changed = await typecheckBuild(f.context, f.pi, f.manifest, { ...candidate, manifest: incompatible });
  expect(changed.status).toBe("failed");
  expect(changed.errors).toEqual(expect.arrayContaining([expect.objectContaining({ file: "index.ts", code: 2322 })]));

  await writeFile(entry, `${caller}\nimport { createPiProvider } from "@chrona/pi";\ncreatePiProvider({ agentUrl: 123 });\n`);
  const invalid = await typecheckBuild(f.context, f.pi, f.manifest, candidate);
  expect(invalid.status).toBe("failed");
  expect(invalid.errors).toEqual(expect.arrayContaining([expect.objectContaining({ file: "index.ts", code: 2322 })]));
  await writeFile(entry, `${caller}\nimport { missing } from "./missing-caller-dependency";\nvoid missing;\n`);
  const missing = await typecheckBuild(f.context, f.pi, f.manifest, candidate);
  expect(missing.status).toBe("failed");
  expect(missing.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2307, message: expect.stringContaining("missing-caller-dependency") })]));

  await writeFile(entry, `${caller}\nimport { createPiProvider } from "@chrona/pi";\nvoid createPiProvider;\n`);
  await rm(join(f.pi, "node_modules/@chrona/pi"), { recursive: true, force: true });
  const missingPackage = await typecheckBuild(f.context, f.pi, f.manifest, candidate);
  expect(missingPackage.status).toBe("failed");
  expect(missingPackage.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2307, message: expect.stringContaining("@chrona/pi") })]));
}, 60_000);

test("compiled checker uses a detached staged Pi without reconstructing host source", async () => {
  const f = await fixture(), harness = join(f.root, "check.ts"), binary = join(f.root, "check");
  await writeFile(harness, `
import { typecheckBuild } from ${JSON.stringify(join(import.meta.dir, "module-typecheck.ts"))};
const [pi, sdk, checker, webFile, runtimesFile] = process.argv.slice(2);
const manifest = await Bun.file(pi + "/module.json").json();
const web = await Bun.file(webFile).json();
const moduleRuntimes = await Bun.file(runtimesFile).json();
const ports = { db: { module: { findMany: async () => [] } }, dataDir: "/unused", now: () => new Date(), moduleRuntimes, moduleSdk: sdk, moduleTypecheck: checker };
console.log(JSON.stringify(await typecheckBuild({ ports, workspaceId: "fixture" } as never, pi, manifest, { moduleName: "web", manifest: web })));
`);
  const built = await Bun.build({ entrypoints: [harness], target: "bun", compile: { outfile: binary } });
  expect(built.success).toBe(true);
  await rm(harness);
  await cp(resolve(import.meta.dir, "../../../../../prisma/migrations"), join(f.root, "prisma/migrations"), { recursive: true });
  const sdk = join(f.root, "sdk"), checker = join(f.root, "typecheck");
  await cp(join(integrations, "module-sdk"), sdk, { recursive: true });
  await cp(join(integrations, "module-typecheck"), checker, { recursive: true });
  // The runtime package carries these third-party dependencies in a release.
  for (const name of ["typescript", "@types/bun", "bun-types", "@types/node", "undici-types"]) await cp(resolve(import.meta.dir, "../../../../../node_modules", name), join(checker, "node_modules", name), { recursive: true, dereference: true });
  const webFile = join(f.root, "web.json"), runtimesFile = join(f.root, "runtimes.json");
  await writeFile(webFile, JSON.stringify(f.web));
  await writeFile(runtimesFile, JSON.stringify(f.moduleRuntimes));
  // The compiled checker cannot infer a host resource path from its Bun virtual
  // filesystem. Supply the same explicitly trusted native helper as the host.
  const processHelper = processHelperPath();
  expect(isAbsolute(processHelper)).toBe(true);
  accessSync(processHelper, constants.X_OK);
  const child = Bun.spawn([binary, f.pi, sdk, checker, webFile, runtimesFile], { cwd: f.root, env: { PATH: process.env.PATH ?? "", DATABASE_URL: `file:${join(f.root, "test.db")}`, CHRONA_PROCESS_HELPER: processHelper }, stdout: "pipe", stderr: "pipe", timeout: 30_000, killSignal: "SIGKILL" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ status: "passed" });
}, 60_000);
