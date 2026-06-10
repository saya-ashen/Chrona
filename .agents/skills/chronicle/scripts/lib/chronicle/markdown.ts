import { ChronicleFrontMatterSchema, type ChronicleFrontMatter, type SourceSymbol, type TestRefs } from "./types";

export interface ParsedChronicle {
  frontMatter: ChronicleFrontMatter;
  body: string;
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

function setValue(root: Record<string, unknown>, path: string[], key: string, value: unknown) {
  let target: Record<string, unknown> = root;
  for (const part of path) target = target[part] as Record<string, unknown>;
  target[key] = value;
}

function containerAt(root: Record<string, unknown>, path: string[]): Record<string, unknown> | unknown[] {
  let target: Record<string, unknown> | unknown[] = root;
  for (const part of path) target = (target as Record<string, unknown>)[part] as Record<string, unknown> | unknown[];
  return target;
}

export function parseYamlLike(yaml: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; key: string }> = [];
  const lines = yaml.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    while (stack.length && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const path = stack.map((s) => s.key);
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      const parent = containerAt(root, path);
      if (!Array.isArray(parent)) throw new Error(`YAML list item without list parent: ${line}`);
      const itemText = trimmed.slice(2);
      if (itemText.includes(":")) {
        const [k, ...rest] = itemText.split(":");
        const obj: Record<string, unknown> = {};
        parent.push(obj);
        const value = rest.join(":").trim();
        if (value) obj[k!.trim()] = parseScalar(value);
        stack.push({ indent, key: String(parent.length - 1) });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }
    const [keyRaw, ...rest] = trimmed.split(":");
    const key = keyRaw!.trim();
    const value = rest.join(":").trim();
    if (value) {
      setValue(root, path, key, parseScalar(value));
      continue;
    }
    const next = lines.slice(lineIndex + 1).find((candidate) => candidate.trim() && !candidate.trimStart().startsWith("#"));
    const nextIndent = next?.match(/^ */)?.[0].length ?? 0;
    const nextIsArray = Boolean(next && nextIndent > indent && next.trim().startsWith("- "));
    const child: Record<string, unknown> | unknown[] = nextIsArray ? [] : {};
    setValue(root, path, key, child);
    stack.push({ indent, key });
  }
  return root;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function renderValue(value: unknown, indent = 0): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return ["[]"];
    const lines: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        const [first, ...rest] = entries;
        if (!first) {
          lines.push(`${pad}- {}`);
          continue;
        }
        const [key, val] = first;
        if (val && typeof val === "object") {
          lines.push(`${pad}- ${key}:`);
          lines.push(...renderObject(val as Record<string, unknown>, indent + 4));
        } else {
          lines.push(`${pad}- ${key}: ${renderScalar(val)}`);
        }
        for (const [k, v] of rest) {
          if (v && typeof v === "object") {
            lines.push(`${pad}  ${k}:`);
            lines.push(...renderValue(v, indent + 4));
          } else {
            lines.push(`${pad}  ${k}: ${renderScalar(v)}`);
          }
        }
      } else {
        lines.push(`${pad}- ${renderScalar(item)}`);
      }
    }
    return lines;
  }
  if (value && typeof value === "object") return renderObject(value as Record<string, unknown>, indent);
  return [`${pad}${renderScalar(value)}`];
}

function renderScalar(value: unknown): string {
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value == null) return "";
  return quote(String(value));
}

function renderObject(obj: Record<string, unknown>, indent = 0): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length === 0) lines.push(`${pad}${key}: []`);
    else if (value && typeof value === "object") lines.push(`${pad}${key}:`, ...renderValue(value, indent + 2));
    else lines.push(`${pad}${key}: ${renderScalar(value)}`);
  }
  return lines;
}

export function stringifyFrontMatter(frontMatter: ChronicleFrontMatter): string {
  return renderObject(frontMatter as unknown as Record<string, unknown>).join("\n") + "\n";
}

export function parseChronicle(content: string): ParsedChronicle {
  const match = content.match(FRONT_MATTER);
  if (!match) throw new Error("Missing YAML front matter");
  const frontMatter = ChronicleFrontMatterSchema.parse(parseYamlLike(match[1]!));
  return { frontMatter, body: content.slice(match[0].length) };
}

export function updateFrontMatter(content: string, frontMatter: ChronicleFrontMatter): string {
  const yaml = `---\n${stringifyFrontMatter(frontMatter)}---\n`;
  if (FRONT_MATTER.test(content)) return content.replace(FRONT_MATTER, yaml);
  return yaml + content;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function markerRegex(owner: "generated" | "ai" | "symbol", name: string, id?: string): RegExp {
  const start = id ? `<!-- ${owner}:${escapeRegex(name)}:start ${escapeRegex(id)} -->` : `<!-- ${owner}:${escapeRegex(name)}:start -->`;
  const end = id ? `<!-- ${owner}:${escapeRegex(name)}:end ${escapeRegex(id)} -->` : `<!-- ${owner}:${escapeRegex(name)}:end -->`;
  return new RegExp(`${escapeRegex(start)}\\n?[\\s\\S]*?\\n?${escapeRegex(end)}`, "m");
}

export function hasMarker(content: string, owner: "generated" | "ai" | "symbol", name: string, id?: string): boolean {
  return markerRegex(owner, name, id).test(content);
}

export function replaceGeneratedBlock(content: string, name: string, id: string | undefined, inner: string): string {
  const start = id ? `<!-- generated:${name}:start ${id} -->` : `<!-- generated:${name}:start -->`;
  const end = id ? `<!-- generated:${name}:end ${id} -->` : `<!-- generated:${name}:end -->`;
  const block = `${start}\n${inner.replace(/\n?$/, "\n")}${end}`;
  const regex = markerRegex("generated", name, id);
  if (!regex.test(content)) return content;
  return content.replace(regex, block);
}

export function symbolSection(symbol: SourceSymbol, tests: TestRefs): string {
  const refs = tests.bySymbol.get(symbol.sourceName) ?? { direct: [], transitive: [] };
  const direct = refs.direct.length ? refs.direct.map((t) => `- ${t}`).join("\n") : "- None found";
  const transitive = refs.transitive.length ? refs.transitive.map((t) => `- ${t}`).join("\n") : "- None found";
  return `<!-- symbol:${symbol.id}:start -->\n\n### \`${symbol.sourceName}\`\n\n<!-- ai:start -->\nTODO: AI fill. Suggested structure: Role, Behavior, Inputs/outputs, Invariants, Coverage.\n<!-- ai:end -->\n\n<!-- generated:tests:start ${symbol.id} -->\nDirect tests:\n${direct}\n\nTransitive tests:\n${transitive}\n<!-- generated:tests:end ${symbol.id} -->\n\n<!-- symbol:${symbol.id}:end -->`;
}

export function ensureSymbolSection(content: string, symbol: SourceSymbol, tests: TestRefs): string {
  if (hasMarker(content, "symbol", symbol.id)) return content;
  return content.replace(/\n*$/, `\n\n${symbolSection(symbol, tests)}\n`);
}

export function markStaleSymbolSection(content: string, id: string): string {
  const regex = markerRegex("symbol", id);
  return content.replace(regex, (block) => (block.includes("**Status:** Stale") ? block : block.replace(/\n### /, "\n**Status:** Stale; source symbol no longer found.\n\n### ")));
}

export function generatedSymbolInventory(symbols: SourceSymbol[]): string {
  if (symbols.length === 0) return "No describable symbols found.\n";
  return ["| Symbol | Kind | Score | Reason | Signature |", "|---|---:|---:|---|---|", ...symbols.map((s) => `| \`${s.sourceName}\` | ${s.kind} | ${s.score} | ${s.reason} | \`${s.signature.replace(/\|/g, "\\|")}\` |`)].join("\n") + "\n";
}

export function createChronicle(frontMatter: ChronicleFrontMatter, symbols: SourceSymbol[], tests: TestRefs): string {
  let body = `# ${frontMatter.source.replace(/\.[^.]+$/, "")}\n\n<!-- ai:start -->\nTODO: AI fill. Summarize file purpose, module behavior, important invariants, and coverage judgment. Keep prose grounded in source and direct tests.\n<!-- ai:end -->\n\n## Generated symbol inventory\n\n<!-- generated:symbols:start -->\n${generatedSymbolInventory(symbols)}<!-- generated:symbols:end -->\n\n## Symbols\n`;
  for (const symbol of symbols) body += `\n${symbolSection(symbol, tests)}\n`;
  return updateFrontMatter(body, frontMatter);
}
