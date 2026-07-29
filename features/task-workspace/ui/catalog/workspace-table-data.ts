import type { ReactNode } from "react";

export type WorkspaceTableColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "link";
  hrefKey?: string;
};

export type WorkspaceTableRow = Record<string, unknown>;

export type WorkspaceTableColumnInput =
  | string
  | { key?: unknown; label?: unknown; type?: unknown; hrefKey?: unknown };

export type WorkspaceTableProps = {
  title?: string | null;
  description?: string | null;
  uri?: string | null;
  path?: string | null;
  displayPath?: string | null;
  columns?: WorkspaceTableColumnInput[] | null;
  pageSize?: number | null;
  contentKind?: string | null;
  contentPreview?: string | null;
  contentTruncated?: boolean | null;
  contentBytes?: number | null;
  previewError?: string | null;
  collapsible?: boolean | null;
  defaultCollapsed?: boolean | null;
  collapseTitle?: string | null;
  collapsedSummary?: string | null;
  wide?: boolean | null;
};

export type ParsedTablePreview = {
  rows: WorkspaceTableRow[];
  inferredColumns: string[];
  parseError: boolean;
};

type CsvParseState = {
  rows: string[][];
  row: string[];
  cell: string;
  quoted: boolean;
};

type CsvNormalizationDecision = {
  matches: (
    state: CsvParseState,
    value: string,
    nextValue: string | undefined,
  ) => boolean;
  apply: (
    state: CsvParseState,
    value: string,
    nextValue: string | undefined,
  ) => boolean;
};

function appendCsvCell(state: CsvParseState) {
  state.row.push(state.cell);
  state.cell = "";
}

function appendCsvRow(state: CsvParseState) {
  appendCsvCell(state);
  state.rows.push(state.row);
  state.row = [];
}

const CSV_NORMALIZATION_DECISIONS: readonly CsvNormalizationDecision[] = [
  {
    matches: (state, value, nextValue) =>
      value === '"' && state.quoted && nextValue === '"',
    apply: (state) => {
      state.cell += '"';
      return true;
    },
  },
  {
    matches: (_state, value) => value === '"',
    apply: (state) => {
      state.quoted = !state.quoted;
      return false;
    },
  },
  {
    matches: (state, value) => value === "," && !state.quoted,
    apply: (state) => {
      appendCsvCell(state);
      return false;
    },
  },
  {
    matches: (state, value) =>
      (value === "\n" || value === "\r") && !state.quoted,
    apply: (state, value, nextValue) => {
      appendCsvRow(state);
      return value === "\r" && nextValue === "\n";
    },
  },
  {
    matches: () => true,
    apply: (state, value) => {
      state.cell += value;
      return false;
    },
  },
];

function csvDecisionFor(
  state: CsvParseState,
  value: string,
  nextValue: string | undefined,
) {
  return (
    CSV_NORMALIZATION_DECISIONS.find((decision) =>
      decision.matches(state, value, nextValue),
    ) ?? CSV_NORMALIZATION_DECISIONS.at(-1)!
  );
}

export function csvRows(content: string) {
  const state: CsvParseState = { rows: [], row: [], cell: "", quoted: false };

  for (let index = 0; index < content.length; index += 1) {
    const value = content[index]!;
    const decision = csvDecisionFor(state, value, content[index + 1]);
    if (decision.apply(state, value, content[index + 1])) index += 1;
  }

  if (state.cell || state.row.length > 0) appendCsvRow(state);
  return state.rows.filter((cells) => cells.some((value) => value.trim()));
}

function tableCellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordsFromRows(matrix: unknown[][]) {
  if (matrix.length === 0) {
    return { rows: [] as WorkspaceTableRow[], inferredColumns: [] as string[] };
  }
  const inferredColumns = matrix[0]!.map(
    (value, index) => tableCellText(value).trim() || `Column ${index + 1}`,
  );
  const rows = matrix.slice(1).map((values) =>
    Object.fromEntries(
      inferredColumns.map((key, index) => [key, values[index] ?? ""]),
    ),
  );
  return { rows, inferredColumns };
}

function recordsFromObjects(items: Array<Record<string, unknown>>) {
  const inferredColumns: string[] = [];
  const rows = items.map((item) => {
    const row: WorkspaceTableRow = {};
    for (const [key, value] of Object.entries(item)) {
      if (!inferredColumns.includes(key)) inferredColumns.push(key);
      row[key] = value;
    }
    return row;
  });
  return { rows, inferredColumns };
}

function tableSourceRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows;
    if (Array.isArray(record.data)) return record.data;
  }
  return [];
}

export function parseTablePreview(
  kind: string | null | undefined,
  preview: string | null | undefined,
): ParsedTablePreview {
  if (!preview) {
    return { rows: [], inferredColumns: [], parseError: false };
  }
  try {
    const rawRows =
      kind === "csv" ? csvRows(preview) : tableSourceRows(JSON.parse(preview));
    if (rawRows.every(Array.isArray)) {
      return { ...recordsFromRows(rawRows as unknown[][]), parseError: false };
    }
    if (
      rawRows.every(
        (row) => row && typeof row === "object" && !Array.isArray(row),
      )
    ) {
      return {
        ...recordsFromObjects(rawRows as Array<Record<string, unknown>>),
        parseError: false,
      };
    }
  } catch {
    return { rows: [], inferredColumns: [], parseError: true };
  }
  return { rows: [], inferredColumns: [], parseError: true };
}

export function normalizeTableColumns(
  propsColumns: WorkspaceTableColumnInput[] | null | undefined,
  inferredColumns: string[],
): WorkspaceTableColumn[] {
  const columns =
    propsColumns?.flatMap<WorkspaceTableColumn>((column) => {
      if (typeof column === "string") return [{ key: column, label: column }];
      if (
        !column ||
        typeof column !== "object" ||
        typeof column.key !== "string"
      ) {
        return [];
      }
      return [
        {
          key: column.key,
          label: typeof column.label === "string" ? column.label : column.key,
          type:
            column.type === "number" || column.type === "link"
              ? column.type
              : "text",
          hrefKey:
            typeof column.hrefKey === "string" ? column.hrefKey : undefined,
        },
      ];
    }) ?? [];
  return columns.length > 0
    ? columns
    : inferredColumns.map((key) => ({ key, label: key }));
}

export function workspaceTableCellText(value: unknown) {
  return tableCellText(value);
}

export function safeExternalHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export type WorkspaceTableCellRenderer = (input: {
  column: WorkspaceTableColumn;
  row: WorkspaceTableRow;
  value: unknown;
}) => ReactNode;
