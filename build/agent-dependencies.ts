import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { bundleDeclarations } from "./agent-declaration-bundle";

const ROOT = resolve(import.meta.dirname, "..");
const AGENT = "packages/engine/src/modules/steward/builtin/agent";
type Package = { name: string; version: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; exports?: Record<string, unknown>; main?: string; types?: string; [key: string]: unknown };
const json = async (file: string): Promise<Package> => JSON.parse(await readFile(file, "utf8"));
const portable = (path: string) => path.split(sep).join("/");

async function installedPackage(name: string, from: string): Promise<string> {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    try { await stat(join(candidate, "package.json")); return await realpath(candidate); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(dir) === dir) throw new Error(`Agent dependency ${name} is not installed (from ${from})`);
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
  // Zod's root exports the complete API Agent uses, including locales. Workspace
  // packages retain every declared public export, notably all of Pi.
  const publicExports = name === "zod" ? { ".": original.exports?.["."] } : original.exports ?? { ".": original.main ?? "./index.js" };
  const runtimeEntries = new Map<string, string>(), typeEntries = new Map<string, string>();
  for (const [key, value] of Object.entries(publicExports)) {
    if (key.includes("*") || key === "./package.json") throw new Error(`Unsupported Agent dependency export: ${name}${key}`);
    const runtime = exportTarget(value, "import"), types = exportTarget(value, "types");
    if (!runtime) throw new Error(`Missing Agent dependency runtime export: ${name}${key}`);
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
  if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error(`Agent dependency declarations failed: ${name}`);
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

/**
 * Ship ordinary packages with bundled runtime exports and their real type graph.
 * Third-party implementation dependencies are bundled, with their licenses; no
 * registry lookup, host-source path, macro, or installer exception is required.
 */
export async function assembleAgentDependencies(agentDir: string, sourceRoot = ROOT) {
  const sourceAgent = join(sourceRoot, AGENT), manifest = await json(join(sourceAgent, "package.json"));
  const names = Object.keys(manifest.dependencies ?? {}).sort();
  const installed = new Map(await Promise.all(names.map(async name => [name, await installedPackage(name, sourceRoot)] as const)));
  await rm(join(agentDir, "vendor"), { recursive: true, force: true });
  for (const name of names) {
    const dir = installed.get(name)!, original = await json(join(dir, "package.json"));
    if (original.name !== name) throw new Error(`Agent dependency name mismatch: ${name}`);
    const target = join(agentDir, "vendor", name);
    await mkdir(target, { recursive: true });
    const { runtimeEntries, typeEntries } = dependencyEntries(name, dir, original);
    const required = new Set<string>();
    const built = await Bun.build({ entrypoints: [...new Set(runtimeEntries.values())], target: "bun", minify: true, splitting: true, plugins: [{ name: "ordinary-agent-dependencies", setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, async args => {
        const dependency = args.path.match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[0];
        if (dependency && dependency !== name && installed.has(dependency) && await installedPackage(dependency, args.resolveDir) === installed.get(dependency)) {
          required.add(dependency);
          return { path: args.path, external: true };
        }
      });
    } }], outdir: join(target, "runtime"), naming: { entry: "[dir]/[name].js", chunk: "chunk-[hash].js" } });
    if (!built.success) throw new AggregateError(built.logs, `Agent dependency bundle failed: ${name}`);
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
        if (!licenses.length) throw new Error(`Missing license for bundled Agent dependency ${pkg.name}`);
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
  await writeFile(join(agentDir, "package.json"), JSON.stringify(packaged, null, 2) + "\n");
  if (resolve(sourceAgent) !== resolve(agentDir)) await cp(join(sourceAgent, "bun.lock"), join(agentDir, "bun.lock"));
}
