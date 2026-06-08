#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { candidateSourceFiles, scanFiles } from "./lib/feature-docs/source-scan";
import { loadRules } from "./lib/feature-docs/rules";
import { testRefsForSource } from "./lib/feature-docs/test-map-adapter";
import {
  createFeatureDoc,
  generatedSymbolInventory,
  hasMarker,
  markerRegex,
  parseFeatureDoc,
  replaceGeneratedBlock,
  updateFrontMatter,
  ensureSymbolSection,
  markStaleSymbolSection,
} from "./lib/feature-docs/markdown";
import { FeatureDocFrontMatterSchema, type FeatureDocFrontMatter, type SourceFileScan, type SourceSymbol, type TestRefs } from "./lib/feature-docs/types";

const INDEX_PATH = path.join("docs", "maps", "feature-docs.index.md");

interface Args {
  command: "select" | "scaffold" | "sync" | "check" | "index";
  path?: string;
  strictAi: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const command = (argv.shift() ?? "check") as Args["command"];
  if (!["select", "scaffold", "sync", "check", "index"].includes(command)) throw new Error(`Unknown command: ${command}`);
  let basePath: string | undefined;
  let strictAi = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--path") basePath = argv[++i];
    else if (argv[i] === "--strict-ai") strictAi = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return { command, path: basePath, strictAi };
}

function docPathFor(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}.feature.md`);
}

function fileSymbolsForDoc(scan: SourceFileScan): SourceSymbol[] {
  return scan.symbols.filter((symbol) => symbol.describe);
}

function frontMatterFor(scan: SourceFileScan, symbols: SourceSymbol[], tests: TestRefs, existing?: FeatureDocFrontMatter): FeatureDocFrontMatter {
  const byId = new Map((existing?.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  const nextSymbols = symbols.map((symbol) => {
    const prev = byId.get(symbol.id);
    return {
      id: symbol.id,
      source_name: prev?.source_name ?? symbol.sourceName,
      kind: symbol.kind,
      describe: symbol.describe,
    };
  });
  for (const prev of existing?.symbols ?? []) {
    if (!nextSymbols.some((symbol) => symbol.id === prev.id)) nextSymbols.push(prev);
  }
  return FeatureDocFrontMatterSchema.parse({
    feature_doc_version: 1,
    scope: existing?.scope ?? "file",
    source: path.basename(scan.filePath),
    owner_feature: existing?.owner_feature ?? scan.ownerFeature,
    owner_capability: existing?.owner_capability ?? scan.ownerCapability,
    layer: existing?.layer ?? scan.layer,
    status: existing?.status ?? "active",
    sync: {
      mode: existing?.sync.mode ?? "scaffold-and-check",
      source_hash: scan.sourceHash,
      last_scanned_commit: existing?.sync.last_scanned_commit ?? "",
    },
    symbols: nextSymbols,
  });
}

function updateDoc(scan: SourceFileScan, createMissing: boolean): { path: string; changed: boolean; created: boolean } | undefined {
  const symbols = fileSymbolsForDoc(scan);
  if (symbols.length === 0) return undefined;
  const docPath = docPathFor(scan.filePath);
  const tests = testRefsForSource(scan.filePath);
  if (!fs.existsSync(docPath)) {
    if (!createMissing) return undefined;
    const fm = frontMatterFor(scan, symbols, tests);
    fs.writeFileSync(docPath, createFeatureDoc(fm, symbols, tests));
    return { path: docPath, changed: true, created: true };
  }
  const before = fs.readFileSync(docPath, "utf8");
  const parsed = parseFeatureDoc(before);
  const fm = frontMatterFor(scan, symbols, tests, parsed.frontMatter);
  let next = updateFrontMatter(before, fm);
  next = replaceGeneratedBlock(next, "symbols", undefined, generatedSymbolInventory(symbols));
  for (const symbol of symbols) {
    next = ensureSymbolSection(next, symbol, tests);
    const refs = tests.bySymbol.get(symbol.sourceName) ?? { direct: [], transitive: [] };
    const direct = refs.direct.length ? refs.direct.map((t) => `- ${t}`).join("\n") : "- None found";
    const transitive = refs.transitive.length ? refs.transitive.map((t) => `- ${t}`).join("\n") : "- None found";
    next = replaceGeneratedBlock(next, "tests", symbol.id, `Direct tests:\n${direct}\n\nTransitive tests:\n${transitive}\n`);
  }
  for (const stale of fm.symbols.filter((symbol) => !symbols.some((current) => current.id === symbol.id))) next = markStaleSymbolSection(next, stale.id);
  if (next !== before) fs.writeFileSync(docPath, next);
  return { path: docPath, changed: next !== before, created: false };
}

function scansFor(basePath?: string): SourceFileScan[] {
  const rules = loadRules();
  return scanFiles(candidateSourceFiles(rules, basePath), rules).filter((scan) => fileSymbolsForDoc(scan).length > 0);
}

function runScaffold(basePath?: string) {
  const results = scansFor(basePath).map((scan) => updateDoc(scan, true)).filter(Boolean);
  console.log(`feature-docs:scaffold docs=${results.length} changed=${results.filter((r) => r!.changed).length} created=${results.filter((r) => r!.created).length}`);
}

function runSync(basePath?: string) {
  const results = scansFor(basePath).map((scan) => updateDoc(scan, false)).filter(Boolean);
  console.log(`feature-docs:sync docs=${results.length} changed=${results.filter((r) => r!.changed).length}`);
}

function discoverDocs(basePath?: string): string[] {
  const prefix = basePath ? basePath.replace(/\/$/, "") : "";
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", "generated", ".git"].includes(entry.name) || entry.name.startsWith(".")) continue;
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile() && entry.name.endsWith(".feature.md") && (!prefix || rel.startsWith(prefix))) out.push(rel);
    }
  };
  walk(prefix || ".");
  return out.sort();
}

function runSelect(basePath?: string) {
  const rules = loadRules();
  const scoringRules = { ...rules, selection: { mode: "score" as const, files: [] } };
  const scans = scanFiles(candidateSourceFiles(scoringRules, basePath), scoringRules)
    .map((scan) => ({ ...scan, symbols: scan.symbols.filter((symbol) => symbol.describe) }))
    .filter((scan) => scan.symbols.length > 0);
  console.log("selection:");
  console.log("  mode: \"explicit\"");
  console.log("  files:");
  if (scans.length === 0) {
    console.log("    []");
    return;
  }
  for (const scan of scans) {
    console.log(`    - path: ${JSON.stringify(scan.filePath)}`);
    console.log(`      reason: ${JSON.stringify(`${scan.ownerFeature} / ${scan.ownerCapability}`)}`);
    console.log("      symbols:");
    for (const symbol of scan.symbols) console.log(`        - ${JSON.stringify(symbol.sourceName)} # score=${symbol.score}; ${symbol.reason}`);
  }
}

function renderIndex(docs = discoverDocs()): string {
  const rows = docs.map((doc) => {
    const fm = parseFeatureDoc(fs.readFileSync(doc, "utf8")).frontMatter;
    const sourcePath = path.join(path.dirname(doc), fm.source);
    return { doc, fm, sourcePath };
  });
  rows.sort((a, b) => `${a.fm.owner_feature}/${a.fm.owner_capability ?? ""}/${a.sourcePath}`.localeCompare(`${b.fm.owner_feature}/${b.fm.owner_capability ?? ""}/${b.sourcePath}`));
  const lines = ["# Feature docs index", "", "Generated by `bun run feature-docs:index`. Do not edit manually.", ""];
  let current = "";
  for (const row of rows) {
    const group = row.fm.owner_feature;
    if (group !== current) {
      if (current) lines.push("");
      current = group;
      lines.push(`## ${group}`, "", "| Capability | Layer | Source | Local doc | Symbols | Coverage status | Status |", "|---|---|---|---|---:|---|---|");
    }
    lines.push(`| ${row.fm.owner_capability ?? ""} | ${row.fm.layer} | \`${row.sourcePath}\` | [doc](../../${row.doc}) | ${row.fm.symbols.filter((s) => s.describe).length} | ${row.fm.coverage?.status ?? "unknown"} | ${row.fm.status} |`);
  }
  return lines.join("\n") + "\n";
}

function runIndex() {
  const next = renderIndex();
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  const before = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, "utf8") : "";
  if (before !== next) fs.writeFileSync(INDEX_PATH, next);
  console.log(`feature-docs:index ${before === next ? "fresh" : "updated"}`);
}

function checkDocMarkers(doc: string, scanBySource: Map<string, SourceFileScan>, errors: string[], strictAi: boolean) {
  const content = fs.readFileSync(doc, "utf8");
  let parsed;
  try {
    parsed = parseFeatureDoc(content);
  } catch (error) {
    errors.push(`${doc}: invalid front matter: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const sourcePath = path.join(path.dirname(doc), parsed.frontMatter.source);
  if (parsed.frontMatter.status === "active" && !fs.existsSync(sourcePath)) errors.push(`${doc}: active source missing: ${sourcePath}`);
  if (!hasMarker(content, "generated", "symbols")) errors.push(`${doc}: missing generated:symbols block`);
  const hasFileAi = (content.includes("<!-- ai:start -->") && content.includes("<!-- ai:end -->")) || hasMarker(content, "ai", "purpose");
  if (!hasFileAi) errors.push(`${doc}: missing ai block`);
  const scan = scanBySource.get(sourcePath);
  for (const symbol of parsed.frontMatter.symbols) {
    if (!symbol.describe) continue;
    if (!hasMarker(content, "symbol", symbol.id)) errors.push(`${doc}: missing symbol section ${symbol.id}`);
    if (!hasMarker(content, "generated", "tests", symbol.id)) errors.push(`${doc}: missing generated tests block ${symbol.id}`);
    const symbolMatch = content.match(markerRegex("symbol", symbol.id));
    const symbolBlock = symbolMatch?.[0] ?? "";
    const hasSimpleAi = symbolBlock.includes("<!-- ai:start -->") && symbolBlock.includes("<!-- ai:end -->");
    const hasLegacyAi = ["role", "behavior", "io", "invariants", "test-assessment"].every((block) => hasMarker(symbolBlock, "ai", block, symbol.id));
    if (!hasSimpleAi && !hasLegacyAi) errors.push(`${doc}: missing ai block ${symbol.id}`);
  }
  if (strictAi && /TODO: AI fill\.|- TODO/.test(content)) errors.push(`${doc}: strict AI mode forbids TODO AI blocks`);
  if (scan) {
    const expected = generatedSymbolInventory(fileSymbolsForDoc(scan)).trim();
    const match = content.match(markerRegex("generated", "symbols"));
    const actual = match?.[0].replace(/^<!-- generated:symbols:start -->\n?/, "").replace(/\n?<!-- generated:symbols:end -->$/, "").trim();
    if (actual !== expected) errors.push(`${doc}: generated symbol inventory stale`);
    if (parsed.frontMatter.sync.source_hash !== scan.sourceHash) errors.push(`${doc}: source hash stale`);
    const tests = testRefsForSource(scan.filePath);
    for (const symbol of fileSymbolsForDoc(scan)) {
      const refs = tests.bySymbol.get(symbol.sourceName) ?? { direct: [], transitive: [] };
      const direct = refs.direct.length ? refs.direct.map((t) => `- ${t}`).join("\n") : "- None found";
      const transitive = refs.transitive.length ? refs.transitive.map((t) => `- ${t}`).join("\n") : "- None found";
      const expectedTests = `Direct tests:\n${direct}\n\nTransitive tests:\n${transitive}`.trim();
      const testsMatch = content.match(markerRegex("generated", "tests", symbol.id));
      const actualTests = testsMatch?.[0]
        .replace(new RegExp(`^<!-- generated:tests:start ${symbol.id} -->\\n?`), "")
        .replace(new RegExp(`\\n?<!-- generated:tests:end ${symbol.id} -->$`), "")
        .trim();
      if (actualTests !== expectedTests) errors.push(`${doc}: generated tests block stale ${symbol.id}`);
    }
    for (const symbol of fileSymbolsForDoc(scan)) {
      if (!parsed.frontMatter.symbols.some((fmSymbol) => fmSymbol.id === symbol.id)) errors.push(`${doc}: describable symbol missing from front matter ${symbol.id}`);
    }
  }
}

function runCheck(basePath: string | undefined, strictAi: boolean) {
  const scans = scansFor(basePath);
  const scanBySource = new Map(scans.map((scan) => [scan.filePath, scan]));
  const errors: string[] = [];
  if (basePath) {
    for (const scan of scans) {
      const doc = docPathFor(scan.filePath);
      if (!fs.existsSync(doc)) errors.push(`${scan.filePath}: missing feature doc ${doc}`);
    }
  }
  for (const doc of discoverDocs(basePath)) checkDocMarkers(doc, scanBySource, errors, strictAi);
  const expectedIndex = renderIndex();
  const actualIndex = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, "utf8") : "";
  if (actualIndex !== expectedIndex) errors.push(`${INDEX_PATH}: stale; run bun run feature-docs:index`);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`feature-docs:check ok docs=${discoverDocs(basePath).length}`);
}

const args = parseArgs();
if (args.command === "select") runSelect(args.path);
else if (args.command === "scaffold") runScaffold(args.path);
else if (args.command === "sync") runSync(args.path);
else if (args.command === "index") runIndex();
else runCheck(args.path, args.strictAi);