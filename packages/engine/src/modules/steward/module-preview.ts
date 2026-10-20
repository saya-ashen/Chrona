import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { StewardError } from "./errors";
import type { ContinuityReport } from "./module-context";

export async function readModuleFiles(root: string, unsafe: string) {
  const files: { path: string; bytes: Buffer }[] = [];
  async function walk(relative: string): Promise<void> {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push({ path, bytes: await readFile(join(root, path)) });
      else throw new StewardError("forbidden", unsafe);
    }
  }
  await walk("");
  return files;
}
function lcsTable(a: string[], b: string[]) {
  const width = b.length + 1, lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    lcs[i * width + j] = a[i] === b[j] ? 1 + lcs[(i + 1) * width + j + 1]! : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
  }
  return { width, lcs };
}
// Bound LCS work for large/generated files; a full replacement is still a valid line diff.
function lineDiff(before: string, after: string): string[] {
  const a = before ? before.split("\n") : [], b = after ? after.split("\n") : [];
  if ((a.length + 1) * (b.length + 1) > 1_000_000) return [...a.map(line => `- ${line}`), ...b.map(line => `+ ${line}`)];
  const { width, lcs } = lcsTable(a, b), lines: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push(`  ${a[i]}`); i++; j++; }
    else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) lines.push(`- ${a[i++]}`);
    else lines.push(`+ ${b[j++]}`);
  }
  return lines;
}
function changeKind(before: Buffer | undefined, after: Buffer | undefined) {
  return !before ? "added" : !after ? "removed" : "changed";
}
export async function codeDifference(store: string, activeHash: string | null, files: { path: string; bytes: Buffer }[]) {
  const previous = new Map<string, Buffer>();
  const activeFiles = activeHash ? await readModuleFiles(join(store, activeHash), "Unsafe module store file") : [];
  activeFiles.forEach(file => previous.set(file.path, file.bytes));
  const proposed = new Map(files.map(file => [file.path, Buffer.from(file.bytes)]));
  const code: string[] = ["代码差异："], unchanged: string[] = [];
  for (const path of [...new Set([...previous.keys(), ...proposed.keys()])].sort()) {
    const before = previous.get(path), after = proposed.get(path);
    if (before && after && before.equals(after)) { unchanged.push(path); continue; }
    code.push(`=== ${path} (${changeKind(before, after)}) ===`);
    for (const line of lineDiff(before?.toString("utf8") ?? "", after?.toString("utf8") ?? "")) code.push(line);
  }
  if (unchanged.length) code.push("未变化:", ...unchanged);
  return code.join("\n") + "\n";
}
export function continuityPreview(continuity: ContinuityReport, needsMigration: boolean) {
  const effects = JSON.stringify(continuity.effects ?? []), effectLimit = 6000;
  return `数据 schema：${continuity.fromSchema ?? "null"} → ${continuity.toSchema}；${needsMigration ? "需要迁移" : "无需迁移"}\n连续性：${continuity.status}${continuity.reason ? ` (${continuity.reason})` : ""}\n按当前数据新版本会产生的 effects：\n${effects.length > effectLimit ? effects.slice(0, effectLimit) + "\n…effects 过长，已截断；完整列表见构建报告" : effects}\n`;
}
export function insertCodeDiff(prefix: string, suffix: string, codeDiff: string, hash: string) {
  const available = 20_000 - (prefix.length + suffix.length);
  if (codeDiff.length <= available) return prefix + codeDiff + suffix;
  const marker = `…代码差异过长，已截断；完整代码可用 chrona_module_checkout 检出 hash ${hash}`;
  // Leave mandatory review text intact, even when it leaves no room for the marker.
  if (available < marker.length + 2) return null;
  return prefix + codeDiff.slice(0, available - marker.length - 2) + "\n" + suffix + "\n" + marker;
}
