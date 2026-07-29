import { flexRender } from "@tanstack/react-table";
import { Badge, Button, cn } from "@shared/ui";
import { formatFileSize } from "./workspace-registry-utilities";
import { type WorkspaceTableProps } from "./workspace-table-data";

import type { WorkspaceTableState } from "./workspace-table-state";

type TablePresentationProps = {
  props: WorkspaceTableProps;
  tableState: WorkspaceTableState;
  error: string | null;
};


function TableMetadata({ props }: { props: WorkspaceTableProps }) {
  const path = props.displayPath ?? props.uri ?? props.path;
  const size = formatFileSize(props.contentBytes);
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        {props.title ? (
          <p className="font-medium text-foreground">{props.title}</p>
        ) : null}
        {props.description ? (
          <p className="text-xs text-muted-foreground">{props.description}</p>
        ) : null}
        {path ? (
          <p className="break-all text-xs text-muted-foreground">{path}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        {props.contentKind ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {props.contentKind}
          </Badge>
        ) : null}
        {size ? <span>{size}</span> : null}
        {props.contentTruncated ? <span>Preview truncated</span> : null}
      </div>
    </div>
  );
}

function TableHeader({ tableState, wide }: Pick<TablePresentationProps, "tableState"> & { wide: boolean }) {
  const { table, tableColumns } = tableState;
  return (
    <thead className={cn("bg-muted/55 [&_tr]:border-b", wide && "sticky top-0 z-20 shadow-sm")}>
      {table.getHeaderGroups().map((headerGroup) => (
        <tr
          key={headerGroup.id}
          className="border-b transition-colors hover:bg-muted/50"
        >
          {headerGroup.headers.map((header) => {
            const sorted = header.column.getIsSorted();
            const column = tableColumns[header.index];
            const numberColumn = column?.type === "number";
            return (
              <th
                key={header.id}
                aria-sort={
                  sorted === "asc"
                    ? "ascending"
                    : sorted === "desc"
                      ? "descending"
                      : "none"
                }
                className={cn(
                  "h-10 px-1 align-middle font-semibold text-foreground",
                  wide
                    ? "w-56 min-w-56 max-w-56 border-r border-border/60 last:border-r-0"
                    : "min-w-0",
                  numberColumn ? "text-right" : "text-left",
                )}
              >
                <button
                  type="button"
                  title="Click to sort"
                  aria-label={`Sort by ${column?.label ?? "column"}`}
                  className={`flex w-full cursor-pointer items-center gap-1 rounded-sm px-1.5 py-1 text-left leading-snug transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${numberColumn ? "justify-end text-right" : "justify-start"}`}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                  >
                    {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}
                  </span>
                </button>
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
}

function TableRows({ props, tableState }: Omit<TablePresentationProps, "error">) {
  const { rowVirtualizer, table, tableColumns } = tableState;
  const displayRows = table.getRowModel().rows;
  const virtualItems = rowVirtualizer.getVirtualItems();
  const items = props.wide
    ? virtualItems.length > 0
      ? virtualItems
      : displayRows
          .slice(0, 20)
          .map((_, index) => ({ index, start: index * 49 }))
    : displayRows.map((_, index) => ({ index, start: index * 49 }));

  return (
    <tbody
      className="[&_tr:last-child]:border-0"
      style={
        props.wide
          ? { height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }
          : undefined
      }
    >
      {items.map((item) => {
        const row = displayRows[item.index];
        if (!row) return null;
        return (
          <tr
            key={row.id}
            data-index={props.wide ? item.index : undefined}
            ref={
              props.wide
                ? (node) => rowVirtualizer.measureElement(node)
                : undefined
            }
            className="border-b transition-colors hover:bg-muted/50"
            style={
              props.wide
                ? {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                    display: "table",
                    tableLayout: "fixed",
                  }
                : undefined
            }
          >
            {row.getVisibleCells().map((cell) => (
              <td
                key={cell.id}
                className={cn(
                  "p-2 align-top text-foreground/80",
                  props.wide
                    ? "w-56 min-w-56 max-w-56 border-r border-border/60 last:border-r-0"
                    : "min-w-0",
                  tableColumns[cell.column.getIndex()]?.type === "number"
                    ? "text-right tabular-nums"
                    : "",
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        );
      })}
    </tbody>
  );
}
function TableFooter({ props, tableState }: Omit<TablePresentationProps, "error">) {
  const { parsed, table } = tableState;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {parsed.rows.length} rows
        {props.wide
          ? " · scroll to explore"
          : ` · ${table.getPageCount() > 1 ? `page ${table.getState().pagination.pageIndex + 1} of ${table.getPageCount()}` : "1 page"}`}
      </span>
      {!props.wide && table.getPageCount() > 1 ? (
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TableGrid({ props, tableState }: Omit<TablePresentationProps, "error">) {
  const { parsed, scrollRef, tableColumns } = tableState;
  return (
    <>
      <div
        ref={props.wide ? scrollRef : undefined}
        data-result-table-scroll={props.wide ? "virtual" : undefined}
        className={cn(
          "min-w-0 w-full max-w-full rounded-md border border-border/80 bg-background",
          props.wide ? "max-h-[60vh] overflow-auto" : "overflow-hidden",
        )}
      >
        <table
          className={cn(
            "caption-bottom text-sm",
            props.wide ? "table-fixed" : "w-full table-fixed",
          )}
          style={
            props.wide
              ? { width: `${Math.max(1, tableColumns.length) * 224}px` }
              : undefined
          }
        >
          <TableHeader tableState={tableState} wide={Boolean(props.wide)} />
          <TableRows props={props} tableState={tableState} />
        </table>
      </div>
      <TableFooter props={props} tableState={{ ...tableState, parsed }} />
    </>
  );
}

export function WorkspaceTablePresentation({
  props,
  tableState,
  error,
}: TablePresentationProps) {
  const { parsed, tableColumns } = tableState;
  return (
    <section className="min-w-0 w-full max-w-full space-y-2 overflow-hidden text-sm">
      <TableMetadata props={props} />
      {error ? (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}
      {parsed.parseError ? (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          Table preview could not be parsed.
        </p>
      ) : null}
      {!error && !parsed.parseError && parsed.rows.length === 0 ? (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          No table rows in preview.
        </p>
      ) : null}
      {parsed.rows.length > 0 && tableColumns.length > 0 ? (
        <TableGrid props={props} tableState={tableState} />
      ) : null}
    </section>
  );
}
