"use client";

import { useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { LocaleType, type ICellData, type IWorkbookData } from "@univerjs/core";
import { createUniver } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import enUS from "@univerjs/preset-sheets-core/locales/en-US";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import type { GoalDataTableContent } from "@chrona/contracts";
import "@univerjs/preset-sheets-core/lib/index.css";

const SHEET_ID = "chrona-asset-sheet";
const WORKBOOK_ID = "chrona-asset-workbook";
const ROW_ID_KEY = "chronaRowId";
const COLUMN_ID_KEY = "chronaColumnId";

export function goalDataTableToWorkbook(table: GoalDataTableContent, name: string, locale: LocaleType): Partial<IWorkbookData> {
  const cellData: Record<number, Record<number, ICellData>> = {};
  cellData[0] = Object.fromEntries(
    table.columns.map((column, index) => [index, { v: column.label }]),
  );
  table.rows.forEach((row, rowIndex) => {
    cellData[rowIndex + 1] = Object.fromEntries(
      table.columns.map((column, columnIndex) => [columnIndex, { v: row.values[column.id] }]),
    );
  });
  const rowData = Object.fromEntries(table.rows.map((row, index) => [index + 1, { custom: { [ROW_ID_KEY]: row.id } }]));
  const columnData = Object.fromEntries(table.columns.map((column, index) => [index, { custom: { [COLUMN_ID_KEY]: column.id } }]));
  return {
    id: WORKBOOK_ID,
    name,
    appVersion: "1.0.0",
    locale,
    styles: {},
    sheetOrder: [SHEET_ID],
    sheets: {
      [SHEET_ID]: {
        id: SHEET_ID,
        name,
        rowCount: Math.max(table.rows.length + 20, 100),
        rowData,
        columnData,
        columnCount: Math.max(table.columns.length + 10, 26),
        cellData,
        freeze: { startRow: 1, startColumn: 0, xSplit: 0, ySplit: 1 },
      },
    },
  };
}

function cellValue(cell: ICellData | undefined) {
  const formula = typeof cell?.f === "string" ? cell.f : null;
  if (formula) return formula.startsWith("=") ? formula : `=${formula}`;
  return typeof cell?.v === "string" || typeof cell?.v === "number" ? cell.v : null;
}

function customId(source: { custom?: unknown } | undefined, key: string) {
  const custom = source?.custom;
  if (!custom || typeof custom !== "object") return null;
  const value = (custom as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function uniqueId(preferred: string | null, used: Set<string>) {
  let id = preferred ?? uuidv4();
  while (used.has(id)) id = uuidv4();
  used.add(id);
  return id;
}

export function workbookToGoalDataTable(snapshot: IWorkbookData, original: GoalDataTableContent): GoalDataTableContent {
  const cells: Record<number, Record<number, ICellData>> = snapshot.sheets[SHEET_ID]?.cellData ?? {};
  const rowData = snapshot.sheets[SHEET_ID]?.rowData ?? {};
  const columnData = snapshot.sheets[SHEET_ID]?.columnData ?? {};
  const persistedRowIndexes = Object.entries(cells)
    .filter(([rowIndex]) => Number(rowIndex) > 0)
    .filter(([rowIndex, row]) => Object.values(row).some((cell) => cellValue(cell) !== null) || customId(rowData[Number(rowIndex)], ROW_ID_KEY))
    .map(([rowIndex]) => Number(rowIndex));
  const populatedColumns = Object.values(cells).flatMap((row) =>
    Object.entries(row)
      .filter(([, cell]) => cellValue(cell) !== null)
      .map(([columnIndex]) => Number(columnIndex)),
  );
  const columnCount = Math.max(1, populatedColumns.length ? Math.max(...populatedColumns) + 1 : 0);
  const originalColumnById = new Map(original.columns.map((column) => [column.id, column]));
  const usedColumnIds = new Set<string>();
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const preferredId = customId(columnData[columnIndex], COLUMN_ID_KEY);
    const id = uniqueId(preferredId, usedColumnIds);
    const previous = originalColumnById.get(id);
    return {
      id,
      label: String(cellValue(cells[0]?.[columnIndex]) ?? previous?.label ?? `Column ${columnIndex + 1}`),
      type: previous?.type ?? ("text" as const),
      ...(previous?.options ? { options: previous.options } : {}),
    };
  });
  const usedRowIds = new Set<string>();
  const rows = persistedRowIndexes.map((rowIndex) => {
    const preferredId = customId(rowData[rowIndex], ROW_ID_KEY);
    const id = uniqueId(preferredId, usedRowIds);
    return {
      id,
      values: Object.fromEntries(columns.map((column, columnIndex) => [column.id, cellValue(cells[rowIndex]?.[columnIndex])])),
    };
  });
  return { schemaVersion: 1, columns, rows };
}

export type SpreadsheetAssetCanvasProps = {
  assetId: string;
  label: string;
  locale: "zh" | "en";
  mode: "read" | "edit";
  table: GoalDataTableContent;
  summary: string;
  onChange: (table: GoalDataTableContent) => void;
};

export function SpreadsheetAssetCanvas({ assetId, label, locale, mode, table, summary, onChange }: SpreadsheetAssetCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialTableRef = useRef(table);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const localeType = locale === "zh" ? LocaleType.ZH_CN : LocaleType.EN_US;
    const { univer, univerAPI } = createUniver({
      locale: localeType,
      locales: { [LocaleType.EN_US]: enUS, [LocaleType.ZH_CN]: zhCN },
      presets: [UniverSheetsCorePreset({
        container,
        header: true,
        toolbar: mode === "edit",
        contextMenu: mode === "edit",
        formulaBar: mode === "edit",
        footer: mode === "edit" ? { sheetBar: true, statisticBar: true } : false,
      })],
    });
    const workbook = univerAPI.createWorkbook(goalDataTableToWorkbook(initialTableRef.current, label, localeType));
    const rendered = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
      if (stage !== univerAPI.Enum.LifecycleStages.Rendered) return;
      const activeWorkbook = univerAPI.getActiveWorkbook();
      if (!activeWorkbook) return;
      const permission = activeWorkbook.getWorkbookPermission();
      if (mode === "edit") {
        activeWorkbook.enableSelection();
        void permission.setEditable();
      } else {
        activeWorkbook.disableSelection();
        void permission.setReadOnly();
        permission.setPermissionDialogVisible(false);
      }
    });
    const subscription = workbook.onCommandExecuted(() => {
      if (mode === "edit") onChangeRef.current(workbookToGoalDataTable(workbook.save(), initialTableRef.current));
    });
    return () => {
      rendered.dispose();
      subscription.dispose();
      univer.dispose();
    };
  }, [assetId, label, locale, mode]);

  return (
    <section
      aria-label={label}
      data-asset-canvas={mode === "edit" ? "spreadsheet-editor" : "data-table"}
      data-asset-canvas-mode={mode}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-xs"
    >
      <div className="border-b bg-muted/20 px-4 py-2 text-sm text-muted-foreground">{summary}</div>
      <div ref={containerRef} className="min-h-[24rem] w-full flex-1" />
    </section>
  );
}
