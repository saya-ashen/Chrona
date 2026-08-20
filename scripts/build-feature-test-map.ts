#!/usr/bin/env bun
/**
 * build-feature-test-map.ts
 *
 * Regenerable feature + test map for the Chrona monorepo.
 *
 * Derives, from the live repo, a drill-down map:
 *   product workflow -> package -> module/feature bucket -> source file
 * annotated at every level with the tests that cover it.
 *
 * Two coverage signals are computed and kept DISTINCT:
 *   - direct:     a test file statically imports the source file
 *                 (honest "this test references this file")
 *   - transitive: a test reaches the source file through the source
 *                 import graph (bounded BFS) -- "this test exercises code
 *                 that pulls this file in"
 *
 * Alias resolution reads tsconfig.json "paths" at generate time, so the
 * generator survives alias changes.
 *
 * Outputs:
 *   docs/maps/feature-test-map.md    (human-readable)
 *   docs/maps/feature-test-map.json  (structured, for tooling/diffing)
 *
 * Usage: bun run scripts/build-feature-test-map.ts [--check]
 *   --check  exit non-zero if regeneration would change the committed output
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import {
  MAX_DEPTH,
  isTestableKind,
  workflowFor,
  type ExportedSymbol,
  type FileEntry,
  type MapModel,
  type SymbolEntry,
  type SymbolKind,
} from "./lib/feature-test-map-model";
import { renderMarkdown } from "./lib/feature-test-map-render";

const ROOT = process.cwd();
const OUT_DIR = path.join("docs", "maps");
const MD_OUT = path.join(OUT_DIR, "feature-test-map.md");
const JSON_OUT = path.join(OUT_DIR, "feature-test-map.json");
const EXTS = [".ts", ".tsx", ".mts"];

function abs(rel: string): string {
  return path.join(ROOT, rel);
}
function exists(rel: string): boolean {
  return fs.existsSync(abs(rel));
}

// ---- file enumeration -----------------------------------------------------
function listRepoFiles(): string[] {
  return execSync("git ls-files --cached --others --exclude-standard", {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

const isTsFile = (f: string) => /\.(ts|tsx|mts)$/.test(f);
const isTestFile = (f: string) => /\.(bun\.test|test|spec)\.(ts|tsx)$/.test(f);
const isGenerated = (f: string) =>
  f.includes("/generated/") || f.includes("node_modules");
const inScope = (f: string) =>
  f.startsWith("apps/") || f.startsWith("packages/") || f.startsWith("scripts/") || f.startsWith("e2e/");

// ---- tsconfig path aliases ------------------------------------------------
interface Alias {
  key: string;
  wild: boolean;
  targets: string[];
}
function loadAliases(): Alias[] {
  const raw = fs.readFileSync(abs("tsconfig.json"), "utf8").replace(/,\s*([}\]])/g, "$1");
  const paths: Record<string, string[]> = JSON.parse(raw).compilerOptions.paths ?? {};
  return Object.entries(paths).map(([k, v]) => ({
    key: k.replace(/\*$/, ""),
    wild: k.endsWith("*"),
    targets: v.map((t) => t.replace(/^\.\//, "").replace(/\*$/, "")),
  }));
}

// ---- import extraction + resolution --------------------------------------
const IMPORT_RE =
  /(?:from\s*|import\s*|require\(\s*|import\(\s*|vi\.mock\(\s*)["']([^"']+)["']/g;

function readImports(rel: string): string[] {
  const txt = fs.readFileSync(abs(rel), "utf8");
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(txt))) set.add(m[1]);
  return [...set];
}

class Resolver {
  constructor(
    private aliases: Alias[],
    private srcSet: Set<string>,
  ) {}

  private fileFor(relNoExt: string): string | null {
    if (this.srcSet.has(relNoExt)) return relNoExt;
    for (const e of EXTS) if (this.srcSet.has(relNoExt + e)) return relNoExt + e;
    for (const e of EXTS)
      if (this.srcSet.has(relNoExt + "/index" + e)) return relNoExt + "/index" + e;
    return null;
  }

  private viaAlias(spec: string): string | null {
    const cands = this.aliases
      .filter((a) => (a.wild ? spec.startsWith(a.key) : spec === a.key))
      .sort((a, b) => b.key.length - a.key.length);
    for (const a of cands) {
      const rest = a.wild ? spec.slice(a.key.length) : "";
      for (const t of a.targets) {
        const rel = (a.wild ? t + rest : t).replace(/\.(ts|tsx|mts)$/, "");
        const hit = this.fileFor(rel);
        if (hit) return hit;
      }
    }
    return null;
  }

  private viaRelative(fromFile: string, spec: string): string | null {
    const rel = path
      .normalize(path.join(path.dirname(fromFile), spec))
      .replace(/\.(ts|tsx|mts)$/, "");
    return this.fileFor(rel);
  }

  resolve(fromFile: string, spec: string): string | null {
    if (spec.startsWith(".")) return this.viaRelative(fromFile, spec);
    if (spec.startsWith("@")) return this.viaAlias(spec);
    return null; // bare package / node builtin: out of repo scope
  }
}

// ---- coverage computation -------------------------------------------------
interface Graph {
  src: string[];
  srcSet: Set<string>;
  adj: Map<string, string[]>;
}

function buildSourceGraph(src: string[], resolver: Resolver): Graph {
  const srcSet = new Set(src);
  const adj = new Map<string, string[]>();
  for (const f of src) {
    const deps = readImports(f)
      .map((s) => resolver.resolve(f, s))
      .filter((r): r is string => !!r && srcSet.has(r));
    adj.set(f, [...new Set(deps)]);
  }
  return { src, srcSet, adj };
}

function reachFrom(starts: string[], adj: Map<string, string[]>): Set<string> {
  const seen = new Set(starts);
  const queue: Array<[string, number]> = starts.map((s) => [s, 0]);
  while (queue.length) {
    const [f, d] = queue.shift()!;
    if (d >= MAX_DEPTH) continue;
    for (const n of adj.get(f) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push([n, d + 1]);
      }
    }
  }
  return seen;
}

interface Coverage {
  direct: Map<string, Set<string>>; // src file -> tests importing it
  transitive: Map<string, Set<string>>; // src file -> tests reaching it
}

function computeCoverage(graph: Graph, tests: string[], resolver: Resolver): Coverage {
  const direct = new Map<string, Set<string>>();
  const transitive = new Map<string, Set<string>>();
  for (const s of graph.src) {
    direct.set(s, new Set());
    transitive.set(s, new Set());
  }
  for (const t of tests) {
    const directDeps = readImports(t)
      .map((s) => resolver.resolve(t, s))
      .filter((r): r is string => !!r && graph.srcSet.has(r));
    for (const d of directDeps) direct.get(d)!.add(t);
    for (const r of reachFrom(directDeps, graph.adj)) transitive.get(r)!.add(t);
  }
  return { direct, transitive };
}

// ---- feature bucketing + product workflow mapping -------------------------
function featureOf(f: string): { pkg: string; module: string } {
  let m: RegExpMatchArray | null;
  if ((m = f.match(/^packages\/engine\/src\/modules\/([^/]+)/)))
    return { pkg: "engine", module: m[1] };
  if ((m = f.match(/^packages\/([^/]+)(?:\/([^/]+))?\/src\/(?:modules\/([^/]+)|([^/]+))/))) {
    const g = m as unknown as Array<string | undefined>;
    const pkg = g[2] ? `${g[1]}/${g[2]}` : (g[1] as string);
    return { pkg, module: g[3] ?? g[4] ?? "(root)" };
  }
  if ((m = f.match(/^apps\/web\/src\/components\/tasks\/(workspace|plan)\//)))
    return { pkg: "web/components", module: `tasks/${m[1]}` };
  if ((m = f.match(/^apps\/web\/src\/components\/([^/]+)/)))
    return { pkg: "web/components", module: m[1] };
  if ((m = f.match(/^apps\/web\/src\/([^/]+)/))) return { pkg: "web", module: m[1] };
  if ((m = f.match(/^apps\/server\/src\/([^/]+)/))) return { pkg: "server", module: m[1] };
  if (f.startsWith("scripts/")) return { pkg: "scripts", module: "(root)" };
  if (f.startsWith("e2e/")) return { pkg: "e2e", module: "(root)" };
  return { pkg: "other", module: f.split("/").slice(0, 2).join("/") };
}

// ---- function-level symbol extraction -------------------------------------
function scriptKind(rel: string): ts.ScriptKind {
  return rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function namedDeclKind(node: ts.Node): SymbolKind | null {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return "type";
  return null;
}

function exportsFromVariable(node: ts.VariableStatement): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  for (const d of node.declarationList.declarations) {
    if (!ts.isIdentifier(d.name)) continue;
    const isFn = !!d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));
    out.push({ name: d.name.text, kind: isFn ? "function" : "const" });
  }
  return out;
}

function exportsFromNode(node: ts.Node): ExportedSymbol[] {
  if (ts.isVariableStatement(node)) return exportsFromVariable(node);
  const kind = namedDeclKind(node);
  const named = node as { name?: ts.Identifier };
  return kind && named.name ? [{ name: named.name.text, kind }] : [];
}

function extractExports(rel: string): ExportedSymbol[] {
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs(rel), "utf8"), ts.ScriptTarget.Latest, true, scriptKind(rel));
  const out: ExportedSymbol[] = [];
  sf.forEachChild((node) => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) out.push({ name: el.name.text, kind: "reexport" });
    } else if (hasExportModifier(node)) {
      out.push(...exportsFromNode(node));
    }
  });
  return out;
}

/** Identifier names referenced anywhere in a (test) file. */
function referencedIdentifiers(rel: string): Set<string> {
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs(rel), "utf8"), ts.ScriptTarget.Latest, false, scriptKind(rel));
  const ids = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) ids.add(n.text);
    n.forEachChild(walk);
  };
  walk(sf);
  return ids;
}

// ---- assembly -------------------------------------------------------------
/** Resolve, for one source file, which of its directly-importing tests reference each export by name. */
function fileSymbols(file: string, directTests: string[], testIdents: Map<string, Set<string>>): SymbolEntry[] {
  return extractExports(file).map((sym) => ({
    name: sym.name,
    kind: sym.kind,
    tests: directTests.filter((t) => testIdents.get(t)!.has(sym.name)),
  }));
}

function buildModel(graph: Graph, tests: string[], cov: Coverage): MapModel {
  const testIdents = new Map(tests.map((t) => [t, referencedIdentifiers(t)] as const));
  const files: FileEntry[] = graph.src.map((file) => {
    const { pkg, module } = featureOf(file);
    const directTests = [...cov.direct.get(file)!].sort();
    const transitiveTests = [...cov.transitive.get(file)!].sort();
    const symbols = fileSymbols(file, directTests, testIdents).map((s) => ({ ...s, tests: s.tests.sort() }));
    return { file, pkg, module, workflow: workflowFor(pkg, module), directTests, transitiveTests, symbols };
  });
  const directCovered = files.filter((f) => f.directTests.length > 0).length;
  const transitiveCovered = files.filter((f) => f.transitiveTests.length > 0).length;
  const testableSymbols = files.flatMap((f) => f.symbols).filter((s) => isTestableKind(s.kind));
  const exportedSymbols = testableSymbols.length;
  const symbolsWithTest = testableSymbols.filter((s) => s.tests.length > 0).length;
  return {
    generatedAt: "GENERATED_AT",
    granularity: "function",
    totals: {
      sourceFiles: graph.src.length,
      testFiles: tests.length,
      directCovered,
      transitiveCovered,
      uncovered: graph.src.length - transitiveCovered,
      exportedSymbols,
      symbolsWithTest,
    },
    files: files.sort((a, b) => a.file.localeCompare(b.file)),
  };
}

// ---- main -----------------------------------------------------------------
function main(): void {
  const check = process.argv.includes("--check");
  const repoFiles = listRepoFiles().filter(
    (f) => isTsFile(f) && !isGenerated(f) && exists(f) && inScope(f),
  );
  const src = repoFiles.filter((f) => !isTestFile(f) && !f.startsWith("e2e/"));
  const tests = repoFiles.filter((f) => isTestFile(f));

  const resolver = new Resolver(loadAliases(), new Set(src));
  const graph = buildSourceGraph(src, resolver);
  const cov = computeCoverage(graph, tests, resolver);
  const model = buildModel(graph, tests, cov);

  // stable JSON: zero out timestamp so --check is deterministic across runs
  const stableModel = { ...model, generatedAt: "(regenerable; see git history)" };
  const jsonOut = JSON.stringify(stableModel, null, 2) + "\n";
  const mdModel = { ...model, generatedAt: "(regenerable; see git history)" };
  const mdOut = renderMarkdown(mdModel) + "\n";

  if (check) {
    const curMd = exists(MD_OUT) ? fs.readFileSync(abs(MD_OUT), "utf8") : "";
    const curJson = exists(JSON_OUT) ? fs.readFileSync(abs(JSON_OUT), "utf8") : "";
    if (curMd !== mdOut || curJson !== jsonOut) {
      console.error("feature-test-map is stale. Run: bun run map:build");
      process.exit(1);
    }
    console.log("feature-test-map is up to date.");
    return;
  }

  fs.mkdirSync(abs(OUT_DIR), { recursive: true });
  fs.writeFileSync(abs(MD_OUT), mdOut);
  fs.writeFileSync(abs(JSON_OUT), jsonOut);
  const t = model.totals;
  console.log(
    `feature-test-map: ${t.sourceFiles} src, ${t.testFiles} tests, ` +
      `${t.directCovered} direct, ${t.transitiveCovered} transitive, ${t.uncovered} uncovered`,
  );
  console.log(`wrote ${MD_OUT} and ${JSON_OUT}`);
}

main();
