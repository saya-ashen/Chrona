import { useMemo, useRef, useState, type RefObject } from "react";
import {
  useVirtualizer,
  type ReactVirtualizer,
} from "@tanstack/react-virtual";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import {
  normalizeTableColumns,
  parseTablePreview,
  type ParsedTablePreview,
  type WorkspaceTableColumn,
  type WorkspaceTableProps,
  type WorkspaceTableRow,
} from "./workspace-table-data";
import { WorkspaceTableCell } from "./workspace-table-cell";

export type WorkspaceTableState = {
  parsed: ParsedTablePreview;
  rowVirtualizer: ReactVirtualizer<HTMLDivElement, Element>;
  scrollRef: RefObject<HTMLDivElement | null>;
  table: Table<WorkspaceTableRow>;
  tableColumns: WorkspaceTableColumn[];
};

export function useWorkspaceTableState(
  props: WorkspaceTableProps,
): WorkspaceTableState {
  const [sorting, setSorting] = useState<SortingState>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(
    () => parseTablePreview(props.contentKind, props.contentPreview),
    [props.contentKind, props.contentPreview],
  );
  const tableColumns = useMemo(
    () => normalizeTableColumns(props.columns, parsed.inferredColumns),
    [props.columns, parsed.inferredColumns],
  );
  const pageSize =
    typeof props.pageSize === "number" && Number.isFinite(props.pageSize)
      ? Math.max(1, Math.min(100, Math.floor(props.pageSize)))
      : 10;
  const columnDefs = useMemo<ColumnDef<WorkspaceTableRow>[]>(
    () =>
      tableColumns.map((column, index) => ({
        id: `${column.key}:${index}`,
        accessorFn: (row) => row[column.key],
        header: column.label,
        cell: ({ getValue, row }) => (
          <WorkspaceTableCell
            column={column}
            row={row.original}
            value={getValue()}
          />
        ),
      })),
    [tableColumns],
  );
  const table = useReactTable({
    data: parsed.rows,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(props.wide
      ? {}
      : {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize } },
        }),
  });

  const displayRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: props.wide ? displayRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 49,
    initialRect: { width: 900, height: 600 },
    overscan: Math.min(20, parsed.rows.length),
  });
  return { parsed, rowVirtualizer, scrollRef, table, tableColumns };
}
