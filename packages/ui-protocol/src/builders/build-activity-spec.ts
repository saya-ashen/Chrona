import type { UiDocument } from "../document/document";

/** Tone values shared with the `ActivityRow` catalog component. */
export type ActivityTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ActivityToolInput {
  name?: string;
  label?: string;
  preview?: string;
  inputSummary?: string;
  durationMs?: number;
  error?: string;
  state: "started" | "completed" | "failed";
}

/**
 * The structural slice of the web `WorkspaceActivityItem` that the builder
 * consumes. Declared here (not imported from the web app) so `ui-protocol`
 * stays React-free; the web model's `WorkspaceActivityItem` satisfies it.
 */
export interface ActivityItemInput {
  id: string;
  kind: string;
  title: string;
  summary?: string;
  description?: string;
  tone?: ActivityTone;
  timestamp?: string | null;
  sourceNodeId?: string;
  sourceNodeTitle?: string;
  provider?: string;
  runtimeName?: string;
  tool?: ActivityToolInput;
  assistant?: { text: string };
  rawEventType?: string;
  activityGroup?: { kind: "plan_generation" | "execution_node" | "provider_run"; id: string };
}

/** Localized labels for tool-detail rows, supplied by the caller (i18n-aware). */
export interface ToolDetailLabels {
  tool: string;
  input: string;
  preview: string;
  duration: string;
  error: string;
}

export interface ActivitySpecOptions {
  density?: "compact" | "detailed";
}

function toolDetailRows(
  tool: ActivityToolInput,
  labels: ToolDetailLabels,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value?: string) => {
    if (value && value.trim()) rows.push({ label, value });
  };
  push(labels.tool, tool.label ?? tool.name);
  push(labels.input, tool.inputSummary);
  push(labels.preview, tool.preview);
  push(labels.duration, tool.durationMs !== undefined ? `${Math.round(tool.durationMs)}ms` : undefined);
  push(labels.error, tool.error);
  return rows;
}

function timeLabel(timestamp: string | null | undefined): string | undefined {
  return timestamp ? timestamp.slice(11, 16) : undefined;
}

/**
 * Deterministically build an Activity feed {@link UiDocument} from typed
 * activity items: a `Stack` of `ActivityRow`, each with an optional
 * `ToolDetails` child. Mirrors today's `WorkspaceActivityFeed` rendering
 * (plan §5.3); pure and cheap so it can be re-run per streamed batch (§8).
 */
export function buildActivitySpec(
  items: ActivityItemInput[],
  toolLabels: ToolDetailLabels,
  options: ActivitySpecOptions = {},
): UiDocument {
  const elements: UiDocument["elements"] = {};
  const rootChildren: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children: rootChildren };

  for (const item of items) {
    const rowKey = `row:${item.id}`;
    const rowChildren: string[] = [];

    if (item.tool && options.density !== "compact") {
      const rows = toolDetailRows(item.tool, toolLabels);
      if (rows.length > 0) {
        const detailsKey = `tool:${item.id}`;
        elements[detailsKey] = { type: "ToolDetails", props: { rows }, children: [] };
        rowChildren.push(detailsKey);
      }
    }

    elements[rowKey] = {
      type: "ActivityRow",
      props: {
        title: item.title,
        text: item.assistant?.text ?? item.summary,
        time: timeLabel(item.timestamp),
        tone: item.tone,
        kind: item.kind,
        sourceNodeTitle: item.sourceNodeTitle,
        provider: item.provider,
        runtimeName: item.runtimeName,
        toolState: item.tool?.state,
        density: options.density,
      },
      children: rowChildren,
    };
    rootChildren.push(rowKey);
  }

  return { root: "root", elements };
}
