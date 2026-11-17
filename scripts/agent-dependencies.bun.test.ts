import { expect, test } from "bun:test";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { assembleModuleDependencies, preparePiApplication, stageModuleMaterial } from "../build/agent-dependencies";
import { moduleGitReleaseSource } from "./module-git-release";
import { snapshotModuleMaterial } from "../packages/kernel/src/modules/module-artifacts";
import { seedTestModuleRelease } from "../packages/kernel/src/modules/module-release-test-fixture";
import { MODULE_MATERIAL_FILE, MODULE_SOURCE_MAX_BYTES, MODULE_SOURCE_MAX_FILES, parseModuleMaterial } from "../packages/contracts/src/steward/module-material";
import { readModuleFiles } from "../packages/kernel/src/modules/module-preview";
import { readModuleMaterial, readModuleSource } from "../packages/kernel/src/modules/module-git";

const piPath = ".generated/applications/pi";

test("compact ordinary packages preserve runtime versions, public exports, real types and license texts", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-closure-"));
  const source = join(root, "source"), output = join(root, "output");
  async function file(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  async function packageAt(path: string, manifest: object, entry: string) {
    await file(join(path, "package.json"), JSON.stringify({ type: "module", exports: { ".": "./index.ts" }, ...manifest }));
    await file(join(path, "index.ts"), entry);
    await file(join(path, "LICENSE"), `Exact copyright and license for ${path}\n`);
  }
  try {
    await file(join(output, "package.json"), JSON.stringify({ name: "pi", version: "1.0.0", dependencies: { child: "file:vendor/child", runtime: "file:vendor/runtime" }, devDependencies: { unused: "*" } }));
    await file(join(output, "bun.lock"), "fixture lock\n");
    await packageAt(join(source, "node_modules/child"), { name: "child", version: "1.0.0" }, 'export const version = "1.0.0" as const;\n');
    const runtime = join(source, "node_modules/runtime"), nested = join(runtime, "node_modules/child");
    await packageAt(runtime, { name: "runtime", version: "1.0.0", exports: { ".": "./index.ts", "./extra": "./extra.ts" }, dependencies: { child: "2.0.0" }, devDependencies: { unused: "*" }, scripts: { test: "node test.js" } }, `
import { version } from "child";
export const nestedVersion = version;
export function literal(value: "a : b ; c"): "a : b ; c" { if (!/a : b ; c/.test(value)) throw new Error("literal changed"); return value; }
export const template = (value: number) => \`a : \${value} ; b\`;
`);
    await file(join(runtime, "extra.ts"), 'export type Public = "extra : value"; export const publicValue: Public = "extra : value";\n');
    await packageAt(nested, { name: "child", version: "2.0.0" }, 'export const version = "2.0.0" as const;\n');
    for (const name of ["test.js", "bench.js", "test/unit.js", "orphan.ts"]) await file(join(runtime, name), 'throw new Error("development file must not ship");\n');
    await assembleModuleDependencies(output, source);
    const packaged = join(output, "vendor/runtime"), manifest = JSON.parse(await readFile(join(packaged, "package.json"), "utf8"));
    for (const name of ["test.js", "bench.js", "test/unit.js", "orphan.ts"]) expect(existsSync(join(packaged, name))).toBe(false);
    expect(Object.keys(manifest.exports)).toEqual([".", "./extra"]);
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.scripts).toBeUndefined();
    const notices = await readFile(join(packaged, "THIRD-PARTY-NOTICES.txt"), "utf8");
    expect(notices).toContain("child@2.0.0");
    expect(notices).toContain(await readFile(join(nested, "LICENSE"), "utf8"));
    expect(notices).toContain(await readFile(join(runtime, "LICENSE"), "utf8"));
    expect(await readFile(join(output, "bun.lock"), "utf8")).toBe("fixture lock\n");
    expect(JSON.parse(await readFile(join(output, "package.json"), "utf8")).devDependencies).toBeUndefined();
    // Runtime and declaration inference must both retain the nested version,
    // rather than silently resolving the root package's different version.
    // Link the local file closure directly; verification must never invoke an installer.
    await mkdir(join(output, "node_modules"));
    for (const name of ["runtime", "child"]) await symlink(join(output, "vendor", name), join(output, "node_modules", name), "junction");
    const probe = Bun.spawn([process.execPath, "--no-install", "-e", 'import {nestedVersion,literal,template} from "runtime"; import {publicValue} from "runtime/extra"; import {version} from "child"; console.log(JSON.stringify([version,nestedVersion,literal("a : b ; c"),template(7),publicValue]));'], { cwd: output, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
    expect(stderr).toBe(""); expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(["1.0.0", "2.0.0", "a : b ; c", "a : 7 ; b", "extra : value"]);
    const entry = join(output, "probe.ts");
    await writeFile(entry, 'import {nestedVersion,literal} from "runtime"; import {publicValue} from "runtime/extra"; const version: "2.0.0" = nestedVersion; const extra: "extra : value" = publicValue; literal("a : b ; c"); literal("wrong");');
    const program = ts.createProgram([entry], { strict: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
    const errors = ts.getPreEmitDiagnostics(program).filter(error => error.file?.fileName === entry);
    expect(errors.map(error => error.code)).toEqual([2345]);
    expect(ts.flattenDiagnosticMessageText(errors[0]!.messageText, "\n")).toContain('"a : b ; c"');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generic staged material preserves generated bytes and executable modes and rejects tampering, unlisted files and oversized source", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-staged-material-")), resources = join(root, "resources"), moduleDir = join(resources, "sample");
  const build = { commands: ["build"], toolchain: "fixture", target: "bun" };
  try {
    await mkdir(join(moduleDir, "dist"), { recursive: true });
    await writeFile(join(moduleDir, "module.json"), JSON.stringify({ name: "sample", entry: "index.ts", tests: ["test.ts"] }));
    await writeFile(join(moduleDir, "index.ts"), 'import "./dist/runtime.js";');
    await writeFile(join(moduleDir, "test.ts"), "export const test = () => true;");
    const artifact = Buffer.alloc(MODULE_SOURCE_MAX_BYTES + 1, 0x61);
    await writeFile(join(moduleDir, "dist/runtime.js"), artifact);
    await chmod(join(moduleDir, "dist/runtime.js"), 0o755);
    const record = await stageModuleMaterial(moduleDir, { artifacts: ["dist"], build });
    expect(record.source).toEqual(["index.ts", "module.json", "test.ts"]);
    expect(record.artifacts).toHaveLength(1);
    expect(record.artifacts[0]).toMatchObject({ path: "dist/runtime.js", executable: true });
    expect((await moduleGitReleaseSource(moduleDir)).map(file => file.path)).toEqual([MODULE_MATERIAL_FILE, "index.ts", "module.json", "test.ts"]);
    const revision = await seedTestModuleRelease(resources, "sample");
    expect((await readModuleMaterial({ platform: join(resources, ".test-release-git"), moduleId: "sample", commit: revision.commit })).find(file => file.path === "dist/runtime.js")).toMatchObject({ bytes: artifact, executable: true });
    await writeFile(join(moduleDir, "dist/runtime.js"), "tampered");
    await expect(moduleGitReleaseSource(moduleDir)).rejects.toThrow();
    await expect(seedTestModuleRelease(resources, "sample")).rejects.toThrow();
    await writeFile(join(moduleDir, "dist/runtime.js"), artifact);
    await chmod(join(moduleDir, "dist/runtime.js"), 0o644);
    await expect(seedTestModuleRelease(resources, "sample")).rejects.toThrow();
    await chmod(join(moduleDir, "dist/runtime.js"), 0o755);
    await writeFile(join(moduleDir, "unlisted.ts"), "unexpected");
    await expect(moduleGitReleaseSource(moduleDir)).rejects.toThrow();
    await expect(seedTestModuleRelease(resources, "sample")).rejects.toThrow();
    await rm(join(moduleDir, "unlisted.ts"));
    await symlink("runtime.js", join(moduleDir, "dist/link.js"));
    await expect(stageModuleMaterial(moduleDir, { artifacts: ["dist"], build })).rejects.toThrow("regular files");
    await rm(join(moduleDir, "dist/link.js"));
    await expect(stageModuleMaterial(moduleDir, { artifacts: ["../outside"], build })).rejects.toThrow("Unsafe");
    await expect(stageModuleMaterial(moduleDir, { artifacts: ["missing"], build })).rejects.toThrow("missing");
    await writeFile(join(moduleDir, "index.ts"), Buffer.alloc(MODULE_SOURCE_MAX_BYTES + 1));
    await expect(stageModuleMaterial(moduleDir, { artifacts: ["dist"], build })).rejects.toThrow();
    await expect(seedTestModuleRelease(resources, "sample")).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the complete generated Pi release preserves artifacts within ordinary material and Git source limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-pi-size-")), resources = join(root, "resources/external"), pi = join(resources, "pi");
  try {
    await cp(resolve(import.meta.dir, "..", piPath), pi, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ["node_modules", "vendor"].includes(part)) });
    await preparePiApplication(join(root, "resources"));
    const record = parseModuleMaterial(JSON.parse(await readFile(join(pi, MODULE_MATERIAL_FILE), "utf8")));
    const files = await readModuleFiles(pi, "Unsafe Pi release");
    const types = files.filter(file => file.path.includes("/types/")).map(file => join(pi, file.path));
    const declarations = ts.createProgram(types, { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
    expect(declarations.getSyntacticDiagnostics().map(error => `${error.file?.fileName}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`)).toEqual([]);
    const probe = join(root, "zod-api.ts");
    await writeFile(probe, `import { z, type ZodType, type input, type output } from "zod";
const record = z.object({ id: z.string().brand<"id">(), count: z.number().int(), role: z.enum(["owner", "reader"]) });
type Result = z.infer<typeof record>;
const parsed: Result = record.parse({ id: "x", count: 1, role: "owner" });
const schema: ZodType<Result> = record;
const count: number = parsed.count;
const wrongCount: string = parsed.count;
const wrongRole: Result["role"] = "writer";
const wrongBrand: Result["id"] = "unbranded";
const transform = z.string().transform(value => value.length);
const before: input<typeof transform> = "ok";
const after: output<typeof transform> = 2;
const badBefore: input<typeof transform> = 2;
const badAfter: output<typeof transform> = "bad";
const recursive = z.object({ name: z.string(), get children() { return z.array(recursive); } });
const childName: string = recursive.parse({ name: "x", children: [] }).children[0]!.name;
const badChild: number = recursive.parse({ name: "x", children: [] }).children[0]!.name;
const union = z.discriminatedUnion("kind", [z.object({ kind: z.literal("ok"), value: z.string() }), z.object({ kind: z.literal("error"), code: z.number() })]);
const badUnion: z.infer<typeof union> = { kind: "ok", value: 3 };
const codec = z.codec(z.string(), z.number(), { decode: Number, encode: String });
const decoded: number = z.decode(codec, "2");
const encoded: string = z.encode(codec, 2);
z.decode(codec, 2);
z.encode(codec, "2");
const registry = z.registry<{ title: string }>();
registry.add(record, { title: "record" });
registry.add(record, { title: 2 });
z.config(z.locales.en());
z.toJSONSchema(record);
`);
    const diagnostics = (types: string) => {
      const program = ts.createProgram([probe], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], paths: { zod: [types] } });
      return ts.getPreEmitDiagnostics(program).map(error => ({ file: error.file?.fileName === probe ? "probe" : error.file?.fileName, line: error.file && error.start !== undefined ? error.file.getLineAndCharacterOfPosition(error.start).line : undefined, code: error.code, message: ts.flattenDiagnosticMessageText(error.messageText, "\n") }));
    };
    const original = diagnostics(resolve(import.meta.dir, "../node_modules/zod/index.d.cts"));
    expect(original).toHaveLength(10);
    expect(original.every(error => error.file === "probe")).toBe(true);
    expect(diagnostics(join(pi, "vendor/zod/types/index.d.ts"))).toEqual(original);
    expect(record.source).toEqual(expect.arrayContaining(["module.json", "package.json", "bun.lock", "runtime.ts", "test.ts", "build.ts", "LICENSE"]));
    expect(record.artifacts.map(file => file.path)).toEqual(expect.arrayContaining(["runtime.js", "test.js", "vendor/zod/runtime/index.js", "vendor/zod/types/index.d.ts"]));
    const source = await moduleGitReleaseSource(pi);
    expect(source.length).toBeLessThanOrEqual(MODULE_SOURCE_MAX_FILES);
    expect(source.reduce((bytes, file) => bytes + file.bytes.byteLength, 0)).toBeLessThanOrEqual(MODULE_SOURCE_MAX_BYTES);
    expect(source.map(file => file.path)).toEqual([MODULE_MATERIAL_FILE, ...record.source].sort((a, b) => a.localeCompare(b)));
    // The actual synthetic seed must retain full verified bytes in the artifact
    // store while its Git tree matches the production release source selector.
    const revision = await seedTestModuleRelease(resources, "pi");
    expect(revision.commit).toMatch(/^[a-f0-9]{40}$/);
    const identity = { platform: join(resources, ".test-release-git"), moduleId: "pi", commit: revision.commit };
    expect((await readModuleSource(identity)).map(file => file.path)).toEqual(source.map(file => file.path));
    const restored = await readModuleMaterial(identity);
    expect(restored.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes), executable: !!file.executable }))).toEqual((await snapshotModuleMaterial(resources, "pi", { verifyTree: true })).map(file => ({ path: file.path, bytes: Buffer.from(file.bytes), executable: !!file.executable })));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
