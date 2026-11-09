import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { assembleAgentDependencies } from "../build/agent-dependencies";
import { buildAgentApplication } from "../packages/engine/src/modules/steward/builtin/agent/build";
import { readModuleFiles } from "../packages/engine/src/modules/steward/module-preview";
import { commitModuleSource } from "../packages/engine/src/modules/steward/module-git";

const agentPath = "packages/engine/src/modules/steward/builtin/agent";

test("compact ordinary packages preserve runtime versions, public exports, real types and license texts", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-agent-closure-"));
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
    await file(join(source, agentPath, "package.json"), JSON.stringify({ name: "agent", version: "1.0.0", dependencies: { child: "file:vendor/child", runtime: "file:vendor/runtime" }, devDependencies: { unused: "*" } }));
    await file(join(source, agentPath, "bun.lock"), "fixture lock\n");
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
    await mkdir(output);
    await assembleAgentDependencies(output, source);
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
    const installed = Bun.spawn([process.execPath, "install", "--ignore-scripts", "--no-cache"], { cwd: output, stdout: "pipe", stderr: "pipe" });
    expect(await installed.exited).toBe(0);
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

test("the complete generated Agent release fits normal module Git limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-agent-size-")), agent = join(root, "agent");
  try {
    await cp(resolve(import.meta.dir, "..", agentPath), agent, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ["node_modules", "vendor"].includes(part)) });
    await assembleAgentDependencies(agent);
    await buildAgentApplication(agent);
    const files = await readModuleFiles(agent, "Unsafe Agent release");
    const types = files.filter(file => file.path.includes("/types/")).map(file => join(agent, file.path));
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
    expect(diagnostics(join(agent, "vendor/zod/types/index.d.ts"))).toEqual(original);
    expect(files.length).toBeLessThanOrEqual(200);
    expect(files.reduce((bytes, file) => bytes + file.bytes.byteLength, 0)).toBeLessThanOrEqual(1024 * 1024);
    // Exercise the ordinary validator itself; no Agent exception or larger cap.
    const revision = await commitModuleSource({ platform: join(root, "platform"), moduleId: "agent", versionId: "compact", files, message: "Compact Agent release" });
    expect(revision.commit).toMatch(/^[a-f0-9]{40}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
