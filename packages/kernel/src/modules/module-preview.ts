import type { ContinuityReport } from "./module-context";

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
/** Changed lines with `context` unchanged lines around them; longer unchanged runs fold into one line (manifest reviews). */
export function compactDiff(before: string, after: string, context = 2) {
  const lines = lineDiff(before, after), keep = lines.map(() => false);
  lines.forEach((line, index) => { if (!line.startsWith("  ")) for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near++) keep[near] = true; });
  const out: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (keep[index]) { out.push(lines[index++]!); continue; }
    let end = index;
    while (end < lines.length && !keep[end]) end++;
    out.push(`  …（${end - index} 行未变）`);
    index = end;
  }
  return out;
}
// Compiled caches (e.g. .pyc) are not text; diffing their bytes shows as mojibake in approvals.
function isText(bytes: Buffer) {
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}
function changeKind(before: Buffer | undefined, after: Buffer | undefined) {
  return !before ? "added" : !after ? "removed" : "changed";
}
function renderFileDifference(code: string[], path: string, before: Buffer | undefined, after: Buffer | undefined) {
  code.push(`=== ${path} (${changeKind(before, after)}) ===`);
  if ([before, after].some(bytes => bytes && !isText(bytes))) {
    code.push(`（二进制文件：${before?.length ?? 0} → ${after?.length ?? 0} 字节）`);
    return;
  }
  code.push(...lineDiff(before?.toString("utf8") ?? "", after?.toString("utf8") ?? ""));
}
export function codeDifference(activeFiles: { path: string; bytes: Buffer }[], files: { path: string; bytes: Buffer }[]) {
  const previous = new Map<string, Buffer>();
  activeFiles.forEach(file => previous.set(file.path, file.bytes));
  const proposed = new Map(files.map(file => [file.path, Buffer.from(file.bytes)]));
  const code: string[] = ["代码差异："], unchanged: string[] = [];
  for (const path of [...new Set([...previous.keys(), ...proposed.keys()])].sort()) {
    const before = previous.get(path), after = proposed.get(path);
    if (before && after && before.equals(after)) { unchanged.push(path); continue; }
    renderFileDifference(code, path, before, after);
  }
  if (unchanged.length) code.push("未变化:", ...unchanged);
  return code.join("\n") + "\n";
}
export function continuityPreview(continuity: ContinuityReport, needsMigration: boolean) {
  return `数据 schema：${continuity.fromSchema ?? "null"} → ${continuity.toSchema}；${needsMigration ? "需要迁移" : "无需迁移"}\n连续性：${continuity.status}${continuity.reason ? ` (${continuity.reason})` : ""}\n应用测试由应用仓执行；数据迁移在批准后备份并执行。\n`;
}
export function insertCodeDiff(prefix: string, suffix: string, codeDiff: string, hash: string, limit = 20_000) {
  const available = limit - (prefix.length + suffix.length);
  if (codeDiff.length <= available) return prefix + codeDiff + suffix;
  const marker = `…代码差异过长，已截断；完整代码可用 m_modules_checkout 检出 hash ${hash}`;
  // Leave mandatory review text intact, even when it leaves no room for the marker.
  if (available < marker.length + 2) return null;
  return prefix + codeDiff.slice(0, available - marker.length - 2) + "\n" + suffix + "\n" + marker;
}
