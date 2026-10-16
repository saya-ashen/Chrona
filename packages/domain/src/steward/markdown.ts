import { affairPathSchema } from "@chrona/contracts/steward";
import { toolSpecSchema, validatePanelEntry, type ToolSpec } from "./tool-spec";

/** Lines are 1-based, matching the HTTP contract. Preserve original newlines. */
export function toggleCheckbox(content: string, line: number, checked: boolean): string {
  const lines = content.split("\n");
  const value = lines[line - 1];
  if (!Number.isInteger(line) || line < 1 || line > lines.length || !/^\s*[-*] \[[ x]\](?:\s|$)/.test(value)) throw new Error("不是任务行");
  lines[line - 1] = value.replace(/^(\s*[-*] \[)[ x](\])/, `$1${checked ? "x" : " "}$2`);
  return lines.join("\n");
}

export const panelSpecSchema = toolSpecSchema.safeExtend({
  data: affairPathSchema.endsWith(".csv").regex(/^[^\\]*$/, "面板数据必须是相对 CSV 路径"),
});
export type PanelBlock = ToolSpec & { data: string };
function parsePanelBody(body: string[]): PanelBlock {
  return panelSpecSchema.parse(JSON.parse(body.join("\n")));
}
/** Invalid/unclosed panel declarations fail explicitly rather than silently hiding data. */
export function parsePanelBlocks(content: string): PanelBlock[] {
  const blocks: PanelBlock[] = [];
  let fence: string | null = null;
  let panel = false;
  let body: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (!open) continue;
      fence = open[1]!;
      panel = fence[0] === "`" && open[2]!.trim() === "chrona-panel";
      body = [];
    } else if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) {
      if (panel) blocks.push(parsePanelBody(body));
      fence = null;
    } else if (panel) body.push(line);
  }
  if (fence !== null && panel) throw new Error("面板代码块未结束");
  return blocks;
}

type CsvCell = { text: string; quoted: boolean; closed: boolean };
function readCsvCharacter(cell: CsvCell, char: string, next: string | undefined): boolean {
  if (cell.quoted) {
    if (char !== '"') cell.text += char;
    else if (next === '"') { cell.text += '"'; return true; }
    else { cell.quoted = false; cell.closed = true; }
  } else if (char === '"' && cell.text === "" && !cell.closed) cell.quoted = true;
  else {
    if (cell.closed || char === '"') throw new Error("无效 CSV");
    cell.text += char;
  }
  return false;
}
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell: CsvCell = { text: "", quoted: false, closed: false };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!;
    if (!cell.quoted && [",", "\n", "\r"].includes(char)) {
      row.push(cell.text);
      cell = { text: "", quoted: false, closed: false };
      if (char !== ",") {
        if (char === "\r" && csv[i + 1] === "\n") i++;
        rows.push(row); row = [];
      }
    } else if (readCsvCharacter(cell, char, csv[i + 1])) i++;
  }
  if (cell.quoted) throw new Error("CSV 引号未结束");
  if (cell.text !== "" || row.length || cell.closed) { row.push(cell.text); rows.push(row); }
  return rows;
}

export function appendCsvRow(csv: string, fields: ToolSpec["fields"], values: unknown): string {
  const spec = toolSpecSchema.parse({ title: "面板", fields, views: [{ kind: "table", columns: fields.map(f => f.key) }] });
  const result = validatePanelEntry(spec, values);
  if (!result.passed) throw new Error(result.failures.join("；"));
  const escape = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const keys = spec.fields.map(f => f.key);
  if (csv !== "") {
    const rows = parseCsv(csv);
    if (rows[0]?.length !== keys.length || keys.some((key, i) => rows[0]?.[i] !== key) || rows.some(row => row.length !== keys.length)) throw new Error("CSV 字段不匹配");
  }
  const newline = csv.includes("\r\n") ? "\r\n" : "\n";
  const prefix = csv === "" ? keys.map(escape).join(",") + newline : csv + (/[\r\n]$/.test(csv) ? "" : newline);
  return prefix + keys.map(key => escape(result.values[key] ?? null)).join(",") + newline;
}
