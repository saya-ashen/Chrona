import chalk from "chalk";
import Table from "cli-table3";

export type OutputFormat = "json" | "table";

export type TableCell = string | number | boolean | null | undefined;

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function outputResult(
  value: unknown,
  format: OutputFormat,
  tableFormatter?: (value: unknown) => string,
): string {
  if (format === "table" && tableFormatter) {
    return tableFormatter(value);
  }

  return stringify(value);
}

export function createTable(headers: string[], rows: TableCell[][]): string {
  const table = new Table({
    head: headers.map((header) => chalk.cyan.bold(header)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push(row.map((cell) => (cell == null ? chalk.dim("—") : String(cell))));
  }

  return table.toString();
}

export function formatKeyValue(title: string, fields: Array<[string, unknown]>): string {
  const lines = [chalk.bold.underline(title)];
  for (const [label, value] of fields) {
    lines.push(`  ${label}: ${value == null ? "—" : typeof value === "object" ? stringify(value) : String(value)}`);
  }
  return lines.join("\n");
}

export function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function getArray(value: unknown, keys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];

  const object = getObject(value);
  for (const key of keys) {
    const nested = object[key];
    if (Array.isArray(nested)) {
      return nested as Record<string, unknown>[];
    }
  }

  return [];
}

export function printErrorAndExit(message: string): never {
  console.error(chalk.red.bold("Error: ") + chalk.red(message));
  process.exit(1);
}

export function invalidJson(label: string): string {
  return `Invalid JSON for ${label}.`;
}

export function invalidNumber(label: string, value: string): string {
  return `Invalid number for ${label}: ${value}`;
}
