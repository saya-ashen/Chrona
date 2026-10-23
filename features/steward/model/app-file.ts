import type { FileNode } from "@chrona/contracts";
import { relativePathSchema } from "@chrona/contracts";
import { parsePanelBlocks, toggleCheckbox, type PanelBlock } from "@chrona/domain";
import { validatePanelEntry } from "./panel";
export { toggleCheckbox };

export type FileBranch = { path: string; name: string; directory: boolean; children: FileBranch[] };
export function fileTree(files: FileNode[]): FileBranch[] {
  const root: FileBranch[] = [];
  for (const file of files) {
    if (file.path.split("/").some(part => part === ".chrona" || part === ".git")) continue;
    let children = root;
    const parts = file.path.split("/");
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let node = children.find(item => item.path === path);
      if (!node) { node = { path, name, directory: index < parts.length - 1 || file.kind === "dir", children: [] }; children.push(node); }
      children = node.children;
    });
  }
  const sort = (nodes: FileBranch[]): FileBranch[] => nodes.sort((a, b) => Number(b.name.toLowerCase() === "readme.md") - Number(a.name.toLowerCase() === "readme.md") || Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)).map(node => ({ ...node, children: sort(node.children) }));
  return sort(root);
}
/** Display name of a page: the file name without a Markdown extension. */
export function pageName(path: string) {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}
function blankSummaryLines(lines: string[], start: number) {
  let i = start;
  while (i < lines.length && lines[i]!.trim() && !/^\s*(?:#|>|[-*+]\s|\d+\.\s|`{3,}|~{3,}|\|)/.test(lines[i]!)) {
    lines[i] = "";
    i++;
  }
}
/** Blank the README summary while retaining source lines for checkbox mutations. */
export function omitReadmeSummary(content: string, path: string): string {
  if (path !== "README.md") return content;
  const lines = content.split("\n");
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { fence = fence ? null : marker; continue; }
    if (fence || !line.trim() || /^\s*(?:#|>|[-*+]\s|\d+\.\s|\|)/.test(line)) continue;
    // A setext heading is a heading, not the summary paragraph.
    if (/^\s*(?:=+|-+)\s*$/.test(lines[i + 1] ?? "")) { i++; continue; }
    blankSummaryLines(lines, i);
    break;
  }
  return lines.join("\n");
}
export function visiblePath(path: string) {
  return relativePathSchema.safeParse(path).success && !path.split("/").some(part => part === ".chrona" || part === ".git");
}
export function fileKind(path: string, mime = "") {
  if (/\.md(?:own)?$|\.markdown$/i.test(path)) return "markdown";
  if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path)) return "image";
  if (/\.(mp3|wav|m4a|ogg|oga|flac|opus)$/i.test(path)) return "audio";
  if (/\.(mp4|webm|ogv|m4v)$/i.test(path)) return "video";
  if (mime.startsWith("text/") || /\.(txt|csv|tsv|json|jsonl|yaml|yml|toml|ini|xml|log|ts|tsx|js|jsx|css|html|sh|py|rb|rs|go|java|c|h|cpp|sql)$/i.test(path) || /(?:^|\/)(?:Dockerfile|Makefile|LICENSE)$/i.test(path)) return "text";
  return "binary";
}
export type MarkdownPart = { kind: "markdown"; text: string } | { kind: "task"; text: string; line: number; checked: boolean } | { kind: "panel"; spec: PanelBlock } | { kind: "invalidPanel"; text: string };
function panelPart(text: string): MarkdownPart {
  try {
    const spec = parsePanelBlocks(text)[0];
    if (spec && visiblePath(spec.data)) return { kind: "panel", spec };
  } catch { /* Render invalid declarations visibly instead of hiding them. */ }
  return { kind: "invalidPanel", text };
}
/** Keep fenced examples inert and preserve the server's 1-based source line numbers. */
export function markdownParts(content: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const lines = content.split("\n");
  let buffer: string[] = [];
  const flush = () => { if (buffer.length) parts.push({ kind: "markdown", text: buffer.join("\n") }); buffer = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const block = [line];
      while (++i < lines.length) { block.push(lines[i]!); if (new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`).test(lines[i]!)) break; }
      if (fence[1]![0] === "`" && fence[2]!.trim() === "chrona-panel") {
        flush();
        parts.push(panelPart(block.join("\n")));
      } else buffer.push(...block);
      continue;
    }
    const task = /^\s*[-*] \[([ x])\](?:\s+(.*)|$)/.exec(line);
    if (task) { flush(); parts.push({ kind: "task", text: task[2] ?? "", line: i + 1, checked: task[1] === "x" }); }
    else buffer.push(line);
  }
  flush(); return parts;
}

function quotedCell(csv: string, start: number, prefix: string, closed: boolean) {
  if (prefix || closed) throw new Error("Invalid CSV");
  let value = "";
  for (let index = start + 1; index < csv.length; index++) {
    if (csv[index] !== '"') value += csv[index];
    else if (csv[index + 1] === '"') { value += '"'; index++; }
    else return { value, end: index };
  }
  throw new Error("Invalid CSV");
}
/** Strict CSV reader: quoted commas/newlines and escaped quotes are supported. */
function csvRows(csv: string) {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let closed = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!;
    if (char === ",") { row.push(value); value = ""; closed = false; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && csv[i + 1] === "\n") i++; row.push(value); rows.push(row); row = []; value = ""; closed = false; }
    else if (char === '"') {
      const cell = quotedCell(csv, i, value, closed); value = cell.value; i = cell.end; closed = true;
    } else { if (closed) throw new Error("Invalid CSV"); value += char; }
  }
  if (value || row.length || closed) rows.push([...row, value]);
  return rows;
}
export function panelRows(csv: string, spec: PanelBlock) {
  const rows = csvRows(csv);
  if (!rows.length) return [];
  const keys = spec.fields.map(field => field.key);
  if (rows[0]!.length !== keys.length || keys.some((key, i) => rows[0]![i] !== key)) throw new Error("Invalid CSV fields");
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== keys.length) throw new Error("Invalid CSV row");
    const parsed = validatePanelEntry(spec, Object.fromEntries(keys.map((key, i) => [key, cells[i]])));
    if (!parsed.passed) throw new Error("Invalid CSV values");
    return { id: String(index), values: parsed.values };
  });
}

export function localAppPath(source: string, pagePath: string): string | null {
  try { source = decodeURIComponent(source.split(/[?#]/, 1)[0]!); } catch { return null; }
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(source)) return null;
  const parts = pagePath.split("/").slice(0, -1);
  for (const part of source.split("/")) { if (part === "..") { if (!parts.length) return null; parts.pop(); } else if (part !== ".") parts.push(part); }
  const path = parts.join("/");
  return visiblePath(path) ? path : null;
}
