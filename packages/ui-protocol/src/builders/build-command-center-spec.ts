import type { UiDocument } from "../document/document";
import { UI_ACTION } from "../actions/actions";
import { buildActivitySpec, type ActivityItemInput, type ToolDetailLabels } from "./build-activity-spec";

export interface CommandCenterArtifactInput {
  id: string;
  title: string;
  type: string;
  uri?: string;
  sourceNodeId?: string;
}

export interface CommandCenterCopyInput {
  activityTitle?: string;
  activityEmpty?: string;
  artifactEmpty?: string;
  from?: string;
  locateSourceNode?: string;
  showAllArtifacts?: string;
  showFewerArtifacts?: string;
}

export interface CommandCenterCheckpointActionInput {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
  requiresPayload?: boolean;
}

export interface CommandCenterCheckpointInput {
  id: string;
  nodeId: string | null;
  title: string;
  message: string;
  severity?: "info" | "warning" | "error";
  availableActions: CommandCenterCheckpointActionInput[];
}

type MutableElements = UiDocument["elements"];

function actionVariant(style: CommandCenterCheckpointActionInput["style"]) {
  if (style === "danger") return "danger";
  if (style === "secondary") return "secondary";
  return "primary";
}

function checkpointTone(severity: CommandCenterCheckpointInput["severity"]) {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

export function buildCommandCenterCheckpointSpec(input: {
  checkpoint: CommandCenterCheckpointInput;
  copy?: CommandCenterCopyInput;
}): UiDocument {
  const { checkpoint } = input;
  const elements: MutableElements = {
    root: { type: "Stack", props: { gap: "sm" }, children: ["status"] },
    status: {
      type: "Alert",
      props: {
        title: checkpoint.title,
        description: checkpoint.message,
        type: checkpointTone(checkpoint.severity),
      },
    },
  };
  const children = elements.root.children ?? [];

  for (const action of checkpoint.availableActions) {
    const actionChildren: string[] = [];
    const actionKey = `action:${action.id}`;
    const stateKey = `payload_${action.id}`;

    if (action.requiresPayload) {
      const fieldKey = `field:${action.id}`;
      elements[fieldKey] = {
        type: "Textarea",
        props: {
          label: action.label,
          name: stateKey,
          value: { $bindState: `/${stateKey}` },
          placeholder: action.label,
        },
      };
      actionChildren.push(fieldKey);
    }

    const submitKey = `submit:${action.id}`;
    elements[submitKey] = {
      type: "Button",
      props: {
        label: action.label,
        variant: actionVariant(action.style),
      },
      on: {
        press: {
          action: UI_ACTION.submitCheckpoint,
          params: {
            actionId: action.id,
            values: action.requiresPayload ? { [stateKey]: { $state: `/${stateKey}` } } : undefined,
          },
        },
      },
    };
    actionChildren.push(submitKey);

    elements[actionKey] = { type: "Stack", props: { gap: "xs" }, children: actionChildren };
    children.push(actionKey);
  }

  return { root: "root", elements, state: {} };
}

export function buildCommandCenterArtifactsSpec(input: {
  artifacts: CommandCenterArtifactInput[];
  copy?: CommandCenterCopyInput;
}): UiDocument {
  const elements: MutableElements = {};
  const artifactChildren: string[] = [];

  for (const artifact of input.artifacts) {
    const key = `artifact:${artifact.id}`;
    elements[key] = {
      type: "WorkspaceArtifactItem",
      props: {
        title: artifact.title,
        type: artifact.type,
        uri: artifact.uri,
        locateLabel: input.copy?.locateSourceNode ?? "Locate source node",
      },
      ...(artifact.sourceNodeId
        ? { on: { locate: { action: UI_ACTION.locateWorkspaceNode, params: { nodeId: artifact.sourceNodeId } } } }
        : {}),
    };
    artifactChildren.push(key);
  }

  elements["artifact-list"] = {
    type: "WorkspaceArtifactList",
    props: {
      emptyLabel: input.copy?.artifactEmpty ?? "No artifacts yet.",
      maxCollapsed: 4,
      showAllLabel: input.copy?.showAllArtifacts,
      showFewerLabel: input.copy?.showFewerArtifacts,
    },
    children: artifactChildren,
  };
  elements.root = { type: "Stack", props: { gap: "sm" }, children: ["artifact-list"] };
  return { root: "root", elements };
}

export function buildCommandCenterTrailSpec(input: {
  activity: ActivityItemInput[];
  liveCount?: number;
  savedCount?: number;
  provider?: string;
  copy?: CommandCenterCopyInput;
  toolLabels: ToolDetailLabels;
}): UiDocument {
  const elements: MutableElements = {};
  const children: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children };
  elements.title = { type: "Heading", props: { text: input.copy?.activityTitle ?? "Execution activity", level: 3 } };
  elements.stats = {
    type: "Text",
    props: { text: `${input.activity.length} shown · ${input.liveCount ?? 0} live · ${input.savedCount ?? input.activity.length} saved`, variant: "caption" },
  };
  children.push("title", "stats");
  if (input.provider) {
    elements.provider = { type: "Badge", props: { label: input.provider, variant: "secondary" } };
    children.push("provider");
  }
  if (input.activity.length === 0) {
    elements.empty = { type: "Alert", props: { title: input.copy?.activityEmpty ?? "Activity will appear after planning or execution starts.", type: "info" } };
    children.push("empty");
  } else {
    const activitySpec = buildActivitySpec(input.activity, input.toolLabels);
    for (const [key, element] of Object.entries(activitySpec.elements)) {
      elements[`activity:${key}`] = {
        ...element,
        children: element.children?.map((child) => `activity:${child}`),
      };
    }
    children.push(`activity:${activitySpec.root}`);
  }
  return { root: "root", elements };
}
