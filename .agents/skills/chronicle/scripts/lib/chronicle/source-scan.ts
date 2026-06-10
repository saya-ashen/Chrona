import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import type { ChronicleFrontMatter, ChronicleRules, ChronicleSymbolKind, SourceFileScan, SourceSymbol } from "./types";

const ROOT = process.cwd();

export function listTrackedFiles(): string[] {
  return Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }).stdout.toString().split("\n").filter(Boolean);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "@@DOUBLE@@").replace(/\*/g, "[^/]*").replace(/@@DOUBLE@@/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(file: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegex(glob).test(file));
}

function selectedEntryFor(file: string, rules: ChronicleRules) {
  return rules.selection.files.find((entry) => entry.path === file);
}

export function candidateSourceFiles(rules: ChronicleRules, basePath?: string): string[] {
  const prefix = basePath ? basePath.replace(/\/$/, "") : "";
  const selected = new Set(rules.selection.files.map((entry) => entry.path));
  return listTrackedFiles()
    .filter((file) => (!prefix || file === prefix || file.startsWith(`${prefix}/`)))
    .filter((file) => matchesAny(file, rules.source.include_globs))
    .filter((file) => !matchesAny(file, rules.source.exclude_globs))
    .filter((file) => !matchesAny(file, rules.exclude.path_globs))
    .filter((file) => rules.selection.mode === "score" || selected.has(file))
    .sort();
}

function sourceHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function layerFor(file: string): ChronicleFrontMatter["layer"] {
  if (file.startsWith("apps/web/")) return "web";
  if (file.startsWith("apps/server/")) return "server";
  if (file.startsWith("packages/engine/")) return "engine";
  if (file.startsWith("packages/contracts/")) return "contracts";
  if (file.startsWith("packages/graph-runtime/")) return "graph-runtime";
  if (file.startsWith("packages/db/")) return "db";
  if (file.startsWith("packages/providers/")) return "provider";
  if (file.startsWith("packages/integrations/")) return "integration";
  if (file.startsWith("external-plugins/")) return "plugin";
  return "unknown";
}

function titleCase(value: string): string {
  return value.split(/[-_/]/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
}

function ownerFeatureFor(file: string): string {
  if (file.includes("/modules/tasks/")) return "Task Management";
  if (file.includes("calendar")) return "Calendar";
  const parts = file.split("/");
  return titleCase(parts.at(-2) ?? "Unknown");
}

function ownerCapabilityFor(file: string): string {
  return titleCase(path.basename(file).replace(/\.(tsx?|mts)$/, ""));
}

function signatureFor(node: Node): string {
  const text = node.getText().replace(/\s+/g, " ").trim();
  const idx = text.indexOf("{");
  return (idx >= 0 ? text.slice(0, idx).trim() : text).slice(0, 220);
}

// Leaf nodes whose literal text carries meaning (identifiers, literals).
// Everything else contributes only its syntactic kind, so the resulting hash
// ignores formatting and comments (trivia are not nodes) while staying
// sensitive to logic, identifier, and literal changes.
function isHashableLeaf(node: Node): boolean {
  switch (node.getKind()) {
    case SyntaxKind.Identifier:
    case SyntaxKind.PrivateIdentifier:
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NumericLiteral:
    case SyntaxKind.BigIntLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
    case SyntaxKind.RegularExpressionLiteral:
    case SyntaxKind.TemplateHead:
    case SyntaxKind.TemplateMiddle:
    case SyntaxKind.TemplateTail:
      return true;
    default:
      return false;
  }
}

function structuralHash(node: Node): string {
  const tokens: string[] = [];
  node.forEachDescendant((descendant) => {
    tokens.push(isHashableLeaf(descendant) ? `${descendant.getKindName()}:${descendant.getText()}` : descendant.getKindName());
  });
  return sourceHash(tokens.join("|"));
}

// The implementation to fingerprint for body_hash: a function/method/arrow
// body, or a documented const's initializer, falling back to the whole node.
function bodyNodeOf(node: Node): Node {
  let target: Node = node;
  if (Node.isVariableDeclaration(target)) target = target.getInitializer() ?? target;
  if (Node.isFunctionDeclaration(target) || Node.isFunctionExpression(target) || Node.isArrowFunction(target) || Node.isMethodDeclaration(target)) {
    return target.getBody() ?? target;
  }
  return target;
}

function isReactComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}
function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

function classifyKind(name: string, baseKind: ChronicleSymbolKind, file: string): ChronicleSymbolKind {
  if (isHookName(name)) return "hook";
  if ((file.endsWith(".tsx") || file.includes("/components/")) && isReactComponentName(name)) return "component";
  if (file.includes("/routes/") || /Route|Handler$/.test(name)) return "route";
  if (/Schema$/.test(name)) return "schema";
  return baseKind;
}

function hintsFor(name: string, file: string, node: Node): string[] {
  const text = node.getText();
  const hints: string[] = [];
  if (file.includes("/routes/") || /route|handler/i.test(name)) hints.push("route_handler");
  if (file.includes("/modules/") && /^(create|update|delete|mark|reopen|accept|get|list)/i.test(name)) hints.push("engine_use_case");
  if (file.includes("providers") || /provider/i.test(file + name)) hints.push("provider_boundary");
  if (/projection|rebuild/i.test(file + name)) hints.push("rebuilds_projection");
  if (/transition|graph/i.test(file + name)) hints.push("graph_transition");
  if (file.endsWith(".tsx") && isReactComponentName(name)) hints.push("public_component");
  if (/\.create\(|\.update\(|\.delete\(|\.upsert\(|\.insert\(|\.execute\(/.test(text)) hints.push("writes_database");
  if (/emit|appendEvent|RawEventLog|event/i.test(text)) hints.push("emits_event");
  return [...new Set(hints)];
}

function scoreSymbol(symbol: Omit<SourceSymbol, "score" | "reason" | "describe">, rules: ChronicleRules): Pick<SourceSymbol, "score" | "reason" | "describe"> {
  let score = symbol.exported ? (rules.score.exported ?? 0) : (rules.score.internal_helper ?? 0);
  const reasons: string[] = [];
  if (symbol.exported) reasons.push("exported");
  for (const hint of symbol.hints) {
    score += rules.score[hint] ?? 0;
    reasons.push(hint);
  }
  if (symbol.kind === "schema") score += rules.score.type_only ?? 0;
  return { score, reason: reasons.join(",") || "internal-helper", describe: score >= rules.describe_threshold };
}

function excludedSymbol(name: string, kind: ChronicleSymbolKind, rules: ChronicleRules): boolean {
  if (rules.exclude.symbol_kinds.includes(kind)) return true;
  return rules.exclude.symbol_name_patterns.some((pattern) => new RegExp(pattern).test(name));
}

function addSymbol(out: SourceSymbol[], name: string, baseKind: ChronicleSymbolKind, exported: boolean, file: string, node: Node, rules: ChronicleRules) {
  const kind = classifyKind(name, baseKind, file);
  if (excludedSymbol(name, kind, rules)) return;
  const signature = signatureFor(node);
  const partial = { id: name, sourceName: name, kind, exported, signature, signatureHash: sourceHash(signature), bodyHash: structuralHash(bodyNodeOf(node)), hints: hintsFor(name, file, node) };
  const scored = scoreSymbol(partial, rules);
  const selected = selectedEntryFor(file, rules);
  if (rules.selection.mode === "explicit") {
    const symbolSelected = Boolean(selected && (!selected.symbols || selected.symbols.includes(name)));
    out.push({ ...partial, ...scored, reason: symbolSelected ? `ai-selected:${selected!.reason}` : scored.reason, describe: symbolSelected });
    return;
  }
  out.push({ ...partial, ...scored });
}

export function scanFiles(files: string[], rules: ChronicleRules): SourceFileScan[] {
  const project = new Project({ tsConfigFilePath: path.join(ROOT, "tsconfig.json"), skipAddingFilesFromTsConfig: true });
  const scans: SourceFileScan[] = [];
  for (const file of files) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) continue;
    const sf = project.addSourceFileAtPath(abs);
    scans.push(scanSourceFile(sf, file, rules));
  }
  return scans;
}

function scanSourceFile(sf: SourceFile, file: string, rules: ChronicleRules): SourceFileScan {
  const symbols: SourceSymbol[] = [];
  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (name) addSymbol(symbols, name, "function", fn.isExported(), file, fn, rules);
  }
  for (const cls of sf.getClasses()) {
    const name = cls.getName();
    if (name) addSymbol(symbols, name, "class", cls.isExported(), file, cls, rules);
  }
  for (const vd of sf.getVariableDeclarations()) {
    const list = vd.getVariableStatement();
    if (!list?.isExported()) continue;
    const name = vd.getName();
    const init = vd.getInitializer();
    const baseKind: ChronicleSymbolKind = init?.isKind(SyntaxKind.ArrowFunction) || init?.isKind(SyntaxKind.FunctionExpression) ? "function" : "const";
    addSymbol(symbols, name, baseKind, true, file, vd, rules);
  }
  const unique = new Map<string, SourceSymbol>();
  for (const symbol of symbols) unique.set(symbol.id, symbol);
  return {
    filePath: file,
    sourceHash: sourceHash(sf.getFullText()),
    layer: layerFor(file),
    ownerFeature: ownerFeatureFor(file),
    ownerCapability: ownerCapabilityFor(file),
    symbols: [...unique.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName)),
  };
}
