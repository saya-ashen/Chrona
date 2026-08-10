import { useI18n } from "@chrona/i18n";
import { filePreviewErrorMessage } from "./workspace-registry-utilities";
import { type WorkspaceTableProps } from "./workspace-table-data";
import { WorkspaceTablePresentation } from "./workspace-table-presentation";
import { useWorkspaceTableState } from "./workspace-table-state";

export function WorkspaceTable({ props }: { props: WorkspaceTableProps }) {
  const { messages } = useI18n();
  const tableState = useWorkspaceTableState(props);
  const error = filePreviewErrorMessage(
    props.previewError,
    messages.components.taskWorkspace,
  );

  return (
    <WorkspaceTablePresentation
      props={props}
      tableState={tableState}
      error={error}
    />
  );
}
