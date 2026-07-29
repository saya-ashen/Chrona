import {
  safeExternalHref,
  workspaceTableCellText,
  type WorkspaceTableColumn,
  type WorkspaceTableRow,
} from "./workspace-table-data";

export function WorkspaceTableCell({
  column,
  row,
  value,
}: {
  column: WorkspaceTableColumn;
  row: WorkspaceTableRow;
  value: unknown;
}) {
  const text = workspaceTableCellText(value);
  const href = column.hrefKey
    ? safeExternalHref(workspaceTableCellText(row[column.hrefKey]))
    : safeExternalHref(text);
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block min-w-0 whitespace-normal break-words font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
      >
        {text}
      </a>
    );
  }
  return (
    <span className="block min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] leading-5">
      {text}
    </span>
  );
}
