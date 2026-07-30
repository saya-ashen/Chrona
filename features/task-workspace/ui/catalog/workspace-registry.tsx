import { ResultCollapseProvider } from "./workspace-collapse";
import type { ResultCollapseCommand } from "./workspace-collapse";
import { VirtualizedCsvPreview } from "./workspace-catalog-components";
import { parseTablePreview } from "./workspace-table-data";
import { workspaceRegistry } from "./workspace-registry-definition";

export type { ResultCollapseCommand };
export { parseTablePreview, ResultCollapseProvider, VirtualizedCsvPreview, workspaceRegistry };
