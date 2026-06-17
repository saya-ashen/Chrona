import type { UiDocument } from "../document/document";
import { UI_ACTION } from "../actions/actions";
import type { ActivityItemInput, ToolDetailLabels } from "./build-activity-spec";

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
function appendDocument(
  target: MutableElements,
  children: string[],
  keyPrefix: string,
  document: UiDocument | null | undefined,
) {
  if (!document?.root || !document.elements[document.root]) return;
  for (const [key, element] of Object.entries(document.elements)) {
    target[`${keyPrefix}:${key}`] = {
      ...element,
      children: element.children?.map((child) => `${keyPrefix}:${child}`),
    };
  }
  children.push(`${keyPrefix}:${document.root}`);
}


const FAILED_RECOVERY_ACTION_IDS = new Set(["retry_node"]);
function shouldRenderCheckpointAction(input: { isRecoveryCheckpoint: boolean; actionId: string }) {
  if (!input.isRecoveryCheckpoint) return true;
  return FAILED_RECOVERY_ACTION_IDS.has(input.actionId);
}


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

export function buildCommandCenterNowSpec(input: {
  title: string;
  description?: string | null;
  statusLabel?: string | null;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  currentOperationSpec?: UiDocument | null;
  copy?: {
    currentOperation?: string;
  };
}): UiDocument {
  const elements: MutableElements = {
    root: { type: "Stack", props: { gap: "sm" }, children: ["status-card"] },
    "status-card": {
      type: "WorkspaceSummaryCard",
      props: {
        eyebrow: input.copy?.currentOperation ?? "Current operation",
        title: input.title,
        description: input.description ?? undefined,
        statusLabel: input.statusLabel ?? undefined,
        tone: input.tone ?? "info",
        icon: input.tone === "warning" || input.tone === "danger" ? "warning" : "sparkles",
      },
    },
  };
  const children = elements.root.children ?? [];
  appendDocument(elements, children, "current-operation", input.currentOperationSpec);
  return { root: "root", elements, state: input.currentOperationSpec?.state };
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
  const recoveryActionChildren: string[] = [];
  const inlineActionChildren: string[] = [];
  const formActionChildren: string[] = [];
  const isRecoveryCheckpoint = checkpoint.severity === "error";

  for (const action of checkpoint.availableActions) {
    if (!shouldRenderCheckpointAction({ isRecoveryCheckpoint, actionId: action.id })) continue;
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
            checkpointId: checkpoint.id,
            actionId: action.id,
            values: action.requiresPayload ? { [stateKey]: { $state: `/${stateKey}` } } : undefined,
          },
        },
      },
    };
    actionChildren.push(submitKey);

    if (isRecoveryCheckpoint) {
      elements[actionKey] = { type: "Stack", props: { gap: "sm" }, children: actionChildren };
      recoveryActionChildren.push(actionKey);
    } else if (action.requiresPayload) {
      elements[actionKey] = {
        type: "WorkspaceActionCard",
        props: { title: action.label, tone: action.style === "danger" ? "danger" : "neutral" },
        children: actionChildren,
      };
      formActionChildren.push(actionKey);
    } else {
      elements[actionKey] = { type: "Stack", props: { gap: "sm" }, children: actionChildren };
      inlineActionChildren.push(actionKey);
    }
  }

  if (recoveryActionChildren.length > 0) {
    elements["recovery-actions"] = {
      type: "WorkspaceActionGroup",
      props: { label: "Recovery actions", layout: "inline" },
      children: recoveryActionChildren,
    };
    children.push("recovery-actions");
  }

  if (inlineActionChildren.length > 0) {
    elements["quick-actions"] = {
      type: "WorkspaceActionGroup",
      props: { label: "Quick actions", layout: "inline" },
      children: inlineActionChildren,
    };
    children.push("quick-actions");
  }

  if (formActionChildren.length > 0) {
    elements["form-actions"] = {
      type: "WorkspaceActionGroup",
      props: { label: "Actions requiring context", layout: "stack" },
      children: formActionChildren,
    };
    children.push("form-actions");
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
  const activity = input.activity;
  const savedCount = input.savedCount ?? activity.length;
  return {
    root: "root",
    state: {
      trail: {
        items: activity,
        liveCount: input.liveCount ?? 0,
        savedCount,
        provider: input.provider ?? null,
      },
    },
    elements: {
      root: { type: "Stack", props: { gap: "sm" }, children: ["title", "provider", "activity"] },
      title: { type: "Heading", props: { text: input.copy?.activityTitle ?? "Execution activity", level: 3 } },
      stats: {
        type: "Text",
        props: { text: `${activity.length} shown · ${input.liveCount ?? 0} live · ${savedCount} saved`, variant: "caption" },
      },
      provider: { type: "Badge", props: { label: input.provider ?? "", variant: "secondary" }, visible: { $state: "/trail/provider" } },
      activity: {
        type: "ActivityStream",
        props: {
          items: { $bindState: "/trail/items" },
          liveCount: { $bindState: "/trail/liveCount" },
          savedCount: { $bindState: "/trail/savedCount" },
          provider: { $bindState: "/trail/provider" },
          emptyMessage: input.copy?.activityEmpty ?? "Activity will appear after planning or execution starts.",
          toolLabels: input.toolLabels,
        },
      },
    },
  };
}
