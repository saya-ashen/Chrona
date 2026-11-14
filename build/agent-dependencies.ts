import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { bundleDeclarations } from "./agent-declaration-bundle";
import { isModuleMaterialPath, MODULE_MATERIAL_FILE, parseModuleMaterial, type ModuleMaterial } from "../packages/contracts/src/steward/module-material";
import { moduleGitReleaseSource } from "../scripts/module-git-release";

const ROOT = resolve(import.meta.dirname, "..");
type Package = { name: string; version: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; exports?: Record<string, unknown>; main?: string; types?: string; [key: string]: unknown };
const json = async (file: string): Promise<Package> => JSON.parse(await readFile(file, "utf8"));
const portable = (path: string) => path.split(sep).join("/");

async function installedPackage(name: string, from: string): Promise<string> {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    try { await stat(join(candidate, "package.json")); return await realpath(candidate); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(dir) === dir) throw new Error(`Module dependency ${name} is not installed (from ${from})`);
  }
}

/** Compact TypeScript without erasing types or changing literal/template contents. */
function compactTypes(text: string, file: string) {
  const printer = ts.createPrinter({ removeComments: false });
  const printed = printer.printFile(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  const parsed = ts.createSourceFile(file, printed, ts.ScriptTarget.Latest, true);
  const literals = new Map<number, number>();
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literals.set(node.getStart(parsed), node.end);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, printed);
  const tokens: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token >= ts.SyntaxKind.FirstTriviaToken && token <= ts.SyntaxKind.LastTriviaToken) {
      const trivia = scanner.getTokenText();
      // Upstream declaration directives are part of the compiler contract.
      if (/^\/[/*].*@ts-(?:ignore|expect-error|nocheck|check)/s.test(trivia)) tokens.push(`\n${trivia}\n`);
      continue;
    }
    // The scanner leaves `>` uncombined for the parser's generic context.
    // Rescan operators so >=, >> and >>= cannot become separate tokens.
    if (token === ts.SyntaxKind.GreaterThanToken) scanner.reScanGreaterToken();
    const start = scanner.getTokenPos(), end = literals.get(start);
    tokens.push(printed.slice(start, end ?? scanner.getTextPos()));
    if (end !== undefined) scanner.setTextPos(end);
  }
  // Keeping a separator between all other tokens also preserves operators such
  // as `+ +`, and TypeScript's contextual keywords. Printed code has explicit ASI.
  return tokens.map((token, index) => index && !/[{}()[\];,.:]$/.test(tokens[index - 1]!) && !/^[{}()[\];,.:]/.test(token) ? ` ${token}` : token).join("") + "\n";
}

function exportTarget(value: unknown, condition: "types" | "import"): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return;
  const conditions = value as Record<string, unknown>;
  for (const key of condition === "types" ? ["types", "import", "default", "require"] : ["import", "default", "require"]) {
    const target = exportTarget(conditions[key], condition);
    if (target) return target;
  }
}

function dependencyEntries(name: string, dir: string, original: Package) {
  // Zod's root exports the complete API the module uses, including locales. Workspace
  // packages retain every declared public export, notably all of Pi.
  const publicExports = name === "zod" ? { ".": original.exports?.["."] } : original.exports ?? { ".": original.main ?? "./index.js" };
  const runtimeEntries = new Map<string, string>(), typeEntries = new Map<string, string>();
  for (const [key, value] of Object.entries(publicExports)) {
    if (key.includes("*") || key === "./package.json") throw new Error(`Unsupported module dependency export: ${name}${key}`);
    const runtime = exportTarget(value, "import"), types = exportTarget(value, "types");
    if (!runtime) throw new Error(`Missing module dependency runtime export: ${name}${key}`);
    runtimeEntries.set(key, resolve(dir, runtime));
    typeEntries.set(key, resolve(dir, types ?? original.types ?? runtime));
  }
  return { runtimeEntries, typeEntries };
}

async function writeTypes(name: string, dir: string, target: string, entries: Map<string, string>) {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, esModuleInterop: true, declaration: true, emitDeclarationOnly: true, removeComments: true };
  const program = ts.createProgram([...new Set(entries.values())], options);
  if (name === "zod") {
    const entry = entries.get(".")!;
    const file = join(target, "types", "index.d.ts");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, compactTypes(bundleDeclarations(name, dir, program, entry), file));
    return { ".": "./types/index.d.ts" };
  }
  const sourceFiles = program.getSourceFiles().filter(file => file.fileName.startsWith(dir + sep) && !relative(dir, file.fileName).split(sep).includes("node_modules"));
  const sources = new Map(sourceFiles.map(file => [relative(dir, file.fileName), compactTypes(file.text, file.fileName)]));
  const declarations = new Map<string, string>();
  const emitted = program.emit(undefined, (file, text) => {
    if (file.startsWith(dir + sep)) declarations.set(relative(dir, file), compactTypes(text, file));
  }, undefined, true);
  if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error(`Module dependency declarations failed: ${name}`);
  // Inferred Zod schemas have larger .d.ts output than their authored types.
  // Types may point to typed source; runtime always loads the JS bundle.
  const bytes = (files: Map<string, string>) => [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  const useSource = declarations.size === 0 || bytes(sources) < bytes(declarations);
  for (const [file, text] of useSource ? sources : declarations) {
    const path = join(target, "types", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  return Object.fromEntries([...entries].map(([key, entry]) => [key, `./types/${portable(relative(dir, useSource ? entry : entry.replace(/\.[cm]?tsx?$/, ".d.ts")))}`]));
}

/** Canonicalize Bun's variable chunk names without merging distinct module instances. */
export async function canonicalizeModuleChunks(outputs: readonly Pick<Bun.BuildArtifact, "path" | "kind">[]): Promise<void> {
  const chunks = new Set(outputs.filter(output => output.kind === "chunk").map(output => resolve(output.path)));
  if (!chunks.size) return;
  const files = new Map(await Promise.all(outputs.filter(output => output.kind === "chunk" || output.kind === "entry-point").map(async output => {
    const path = resolve(output.path), text = await readFile(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports: { start: number; end: number; path: string }[] = [];
    function visit(node: ts.Node) {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
        const dependency = resolve(dirname(path), specifier.text);
        if (chunks.has(dependency)) imports.push({ start: specifier.getStart(source), end: specifier.end, path: dependency });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return [path, { text, imports: imports.sort((a, b) => a.start - b.start) }] as const;
  })));
  // Anchor identity in stable entry paths and the first traversal of import sites
  // in source order. Bun's chunk names and output enumeration never order this
  // walk; repeated imports of the same original chunk retain a single identity.
  let common = dirname(files.keys().next().value!);
  while ([...files.keys()].some(path => !path.startsWith(common + sep))) common = dirname(common);
  const identities = new Map<string, string>();
  function identify(path: string, identity: string) {
    if (identities.has(path)) return;
    identities.set(path, identity);
    files.get(path)!.imports.forEach((specifier, index) => identify(specifier.path, `${identity}/${index}`));
  }
  for (const path of [...files.keys()].filter(path => !chunks.has(path)).sort()) identify(path, JSON.stringify(portable(relative(common, path))));
  const rewritten = new Map<string, { path: string; text: string }>();
  const visiting: string[] = [];
  function rewrite(path: string): { path: string; text: string } {
    const done = rewritten.get(path);
    if (done) return done;
    if (visiting.includes(path)) throw new Error(`Cannot canonicalize cyclic module chunks: ${[...visiting, path].map(file => portable(file)).join(" -> ")}`);
    visiting.push(path);
    const file = files.get(path)!;
    let text = file.text;
    for (const specifier of file.imports.toReversed()) {
      const dependency = rewrite(specifier.path);
      const target = portable(relative(dirname(path), dependency.path));
      text = text.slice(0, specifier.start) + JSON.stringify(target.startsWith(".") ? target : `./${target}`) + text.slice(specifier.end);
    }
    const identity = identities.get(path);
    if (identity === undefined) throw new Error(`Cannot canonicalize module chunk unreachable from an entrypoint: ${portable(path)}`);
    const result = { path: chunks.has(path) ? join(dirname(path), `chunk-${createHash("sha256").update(JSON.stringify([identity, text])).digest("hex")}.js`) : path, text };
    visiting.pop();
    rewritten.set(path, result);
    return result;
  }
  // Resolve the entire graph before touching files, so unsupported cycles leave
  // the original build intact. Only module specifiers change, never string data.
  for (const path of files.keys()) rewrite(path);
  for (const file of rewritten.values()) await writeFile(file.path, file.text);
  const retained = new Set([...rewritten.values()].map(file => file.path));
  for (const path of chunks) if (!retained.has(path)) await rm(path);
}

/**
 * Ship ordinary packages with bundled runtime exports and their real type graph.
 * Third-party implementation dependencies are bundled, with their licenses; no
 * registry lookup, host-source path, macro, or installer exception is required.
 */
export async function assembleModuleDependencies(moduleDir: string, sourceRoot = ROOT) {
  const manifest = await json(join(moduleDir, "package.json"));
  const names = Object.keys(manifest.dependencies ?? {}).sort();
  const installed = new Map(await Promise.all(names.map(async name => [name, await installedPackage(name, sourceRoot)] as const)));
  await rm(join(moduleDir, "vendor"), { recursive: true, force: true });
  for (const name of names) {
    const dir = installed.get(name)!, original = await json(join(dir, "package.json"));
    if (original.name !== name) throw new Error(`Module dependency name mismatch: ${name}`);
    const target = join(moduleDir, "vendor", name);
    await mkdir(target, { recursive: true });
    const { runtimeEntries, typeEntries } = dependencyEntries(name, dir, original);
    const required = new Set<string>();
    const built = await Bun.build({ entrypoints: [...new Set(runtimeEntries.values())], target: "bun", minify: true, splitting: true, plugins: [{ name: "ordinary-module-dependencies", setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, async args => {
        const dependency = args.path.match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[0];
        if (dependency && dependency !== name && installed.has(dependency) && await installedPackage(dependency, args.resolveDir) === installed.get(dependency)) {
          required.add(dependency);
          return { path: args.path, external: true };
        }
      });
    } }], outdir: join(target, "runtime"), naming: { entry: "[dir]/[name].js", chunk: "chunk-[hash].js" } });
    if (!built.success) throw new AggregateError(built.logs, `Module dependency bundle failed: ${name}`);
    await canonicalizeModuleChunks(built.outputs);
    // Bun's entry paths are relative to their common ancestor.
    let common = dirname([...runtimeEntries.values()][0]!);
    while ([...runtimeEntries.values()].some(entry => !entry.startsWith(common + sep))) common = dirname(common);
    const types = await writeTypes(name, dir, target, typeEntries);
    const packagedExports = Object.fromEntries([...runtimeEntries].map(([key, entry]) => [key, { types: types[key]!, import: `./runtime/${portable(relative(common, entry)).replace(/\.[cm]?[jt]sx?$/, ".js")}` }]));
    for (const entry of Object.values(packagedExports)) for (const file of Object.values(entry)) await stat(join(target, file));

    // Record every bundled package/version and preserve its actual license and
    // notice texts, including dependencies whose implementation was tree-shaken.
    const seen = new Set<string>(), notices: string[] = [];
    async function license(packageDir: string) {
      if (seen.has(packageDir)) return;
      seen.add(packageDir);
      const pkg = await json(join(packageDir, "package.json"));
      notices.push(`=== ${pkg.name}@${pkg.version} ===\n`);
      const licenses = (await readdir(packageDir)).filter(file => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file)).sort();
      if (!licenses.length && packageDir.startsWith(join(sourceRoot, "packages") + sep)) notices.push(await readFile(join(sourceRoot, "LICENSE"), "utf8"));
      else {
        if (!licenses.length) throw new Error(`Missing license for bundled module dependency ${pkg.name}`);
        for (const file of licenses) notices.push(`${file}\n${await readFile(join(packageDir, file), "utf8")}`);
      }
      for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).sort()) {
        const dependencyDir = await installedPackage(dependency, packageDir);
        if (names.includes(dependency) && dependencyDir === installed.get(dependency)) required.add(dependency);
        else await license(dependencyDir);
      }
    }
    await license(dir);
    await writeFile(join(target, "THIRD-PARTY-NOTICES.txt"), notices.join("\n") + "\n");
    const dependencies = Object.fromEntries([...required].sort().map(dependency => [dependency, `file:${portable(relative(join("vendor", name), join("vendor", dependency)))}`]));
    await writeFile(join(target, "package.json"), JSON.stringify({ name, version: original.version, type: "module", license: original.license, exports: packagedExports, dependencies }, null, 2) + "\n");
  }
  const { devDependencies: _dev, ...packaged } = manifest;
  await writeFile(join(moduleDir, "package.json"), JSON.stringify(packaged, null, 2) + "\n");
}

// Retained for the existing integration fixture outside the build transition.
export { assembleModuleDependencies as assembleAgentDependencies };

/** Record explicit build outputs without removing source, types, tests or dependency material. */
export async function stageModuleMaterial(moduleDir: string, input: { artifacts: string[]; build: ModuleMaterial["build"] }): Promise<ModuleMaterial> {
  if (input.artifacts.some(path => path === MODULE_MATERIAL_FILE || !isModuleMaterialPath(path))) throw new Error("Unsafe generated module artifact path");
  const files: { path: string; bytes: Buffer; executable: boolean }[] = [];
  const ignored = new Set([".git", "node_modules", ".venv", ".chrona"]);
  async function walk(prefix: string) {
    for (const entry of await readdir(join(moduleDir, prefix), { withFileTypes: true })) {
      if (!prefix && (ignored.has(entry.name) || entry.name === MODULE_MATERIAL_FILE)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!isModuleMaterialPath(path)) throw new Error(`Unsafe staged module path: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push({ path, bytes: await readFile(join(moduleDir, path)), executable: !!((await lstat(join(moduleDir, path))).mode & 0o111) });
      else throw new Error(`Staged module material must contain regular files: ${path}`);
    }
  }
  await walk("");
  files.sort((a, b) => a.path.localeCompare(b.path));
  const generated = (path: string) => input.artifacts.some(output => path === output || path.startsWith(output + "/"));
  for (const output of input.artifacts) if (!files.some(file => file.path === output || file.path.startsWith(output + "/"))) throw new Error(`Generated module output is missing: ${output}`);
  const record = parseModuleMaterial({ schema: 1, source: files.filter(file => !generated(file.path)).map(file => file.path), artifacts: files.filter(file => generated(file.path)).map(file => ({ path: file.path, sha256: createHash("sha256").update(file.bytes).digest("hex"), ...(file.executable ? { executable: true } : {}) })), build: input.build });
  await writeFile(join(moduleDir, MODULE_MATERIAL_FILE), JSON.stringify(record, null, 2) + "\n");
  // Use exactly the production release validator, including both size policies,
  // complete-tree coverage, artifact digests and executable modes.
  await moduleGitReleaseSource(moduleDir);
  return record;
}

/** Build the staged Provider application before pinning or verifying its Git material. */
export async function preparePiApplication(resourcesRoot: string): Promise<void> {
  const { buildPiApplication } = await import("../packages/engine/src/modules/steward/external/pi/build");
  const moduleDir = resolve(resourcesRoot, "external/pi");
  await buildPiApplication(moduleDir);
  await assembleModuleDependencies(moduleDir);
  // Release seed preparation stages this shared license too. Include it before
  // recording material so that later identical staging keeps complete coverage.
  await writeFile(join(moduleDir, "LICENSE"), await readFile(join(ROOT, "LICENSE")));
  await stageModuleMaterial(moduleDir, { artifacts: ["runtime.js", "test.js", "vendor"], build: { commands: ["bun build.ts", "assembleModuleDependencies"], toolchain: `bun ${Bun.version}`, target: "bun" } });
}
