import type { UiDocument } from "../document/document";
import { ActionBindingSchema, type ActionBinding } from "@json-render/core";

export interface ActionFieldInput {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  value: string | boolean | string[];
  control?: "text" | "textarea" | "select" | "approval" | "choice" | "boolean";
  required?: boolean;
  options?: string[];
  selection?: "single" | "multiple";
}

export interface ActionItemInput {
  id: string;
  label: string;
  kind: string;
  emphasis?: "default" | "primary" | "warning" | "danger";
  checkpointId?: string;
  checkpointAction?: string;
  executionAction?: Record<string, unknown>;
}

export interface ActionSpecInput {
  fields: ActionFieldInput[];
  actions: ActionItemInput[];
  /** Values already submitted (shown read-only). */
  submittedValues?: Record<string, string | boolean | string[]>;
  /** When true, renders submitted state: disabled inputs + Alert, no submit button. */
  isReadOnly?: boolean;
  /** Guidance text shown above the form (e.g. node.nextAction). */
  nodeNextAction?: string | null;
  /** When set, shows a warning Alert and disables the submit button. Mirrors legacy disabledActionReason. */
  disabledReason?: string | null;
  /** When true, disables the submit button only (no Alert). Used for required-field emptiness gate. */
  disabledButton?: boolean;
}

const DEFAULT_APPROVAL_OPTIONS = ["Approve", "Reject", "Needs changes"];

function primaryAction(actions: ActionItemInput[]): ActionItemInput | undefined {
  return actions.find((a) => a.emphasis === "primary") ?? actions[0];
}


function checkpointActionBinding(checkpointAction: string | { $state: string } | null): ActionBinding {
  return ActionBindingSchema.parse({
    action: "submit-checkpoint",
    params: {
      checkpointAction,
      values: { $state: "/" },
    },
  });
}

function actionBindingFor(primary: ActionItemInput, hasMultipleCheckpoints: boolean): ActionBinding {
  if (primary.executionAction) {
    return ActionBindingSchema.parse({
      action: "dispatch-execution",
      params: { actionId: primary.id },
    });
  }

  return checkpointActionBinding(
    hasMultipleCheckpoints ? { $state: "/__checkpointAction" } : (primary.checkpointAction ?? null),
  );
}

/**
 * Deterministically build a Node-action {@link UiDocument} from typed
 * plan-node fields and available actions (plan §5.2). Mirrors the layout of
 * `WorkspaceNodeActionControls`:
 *   - shadcn `Input` / `Textarea` / `Select` per interactive field, bound to
 *     form state via `$bindState`
 *   - action-selector `Select` when multiple checkpoint actions are present
 *   - submit `Button` binding `dispatch-execution` (execution actions) or
 *     `submit-checkpoint` (checkpoint actions), passing form state via `$state`
 *
 * Readonly state (submitted input): disabled inputs + `Alert` (type "info"),
 * no submit button. Pure and cheap — safe to rebuild on every node update.
 *
 * Note: `$bindState` references in field `value` props are resolved by
 * json-render's `StateProvider` at render time. These props intentionally do
 * not conform to the catalog Zod string schema, so backend action specs must
 * be validated with `validateChronaSpec`, which accepts dynamic expressions.
 * Action bindings are parsed through json-render's `ActionBindingSchema`
 * before they become part of the document.
 */
export function buildActionSpec(input: ActionSpecInput): UiDocument {
  const { fields, actions, submittedValues, isReadOnly = false, nodeNextAction, disabledReason, disabledButton } = input;
  const elements: UiDocument["elements"] = {};
  const state: Record<string, unknown> = {};
  const rootChildren: string[] = [];

  elements.root = { type: "Stack", props: { gap: "sm" }, children: rootChildren };

  if (nodeNextAction) {
    elements.guidance = { type: "Text", props: { text: nodeNextAction } };
    rootChildren.push("guidance");
  }

  if (isReadOnly) {
    elements["submitted-alert"] = {
      type: "Alert",
      props: { title: "Submitted", type: "info" },
    };
    rootChildren.push("submitted-alert");
  }

  if (disabledReason) {
    elements["disabled-alert"] = {
      type: "Alert",
      props: { title: disabledReason, type: "warning" },
    };
    rootChildren.push("disabled-alert");
  }

  for (const field of fields) {
    const elemKey = `field:${field.key}`;
    const stateKey = `/${field.key}`;
    const fieldValue = isReadOnly
      ? (submittedValues?.[field.key] ?? field.value ?? "")
      : (field.value ?? "");

    // Readonly fields still use $bindState + state seed because shadcn
    // Input/Select initialize localValue="" and ignore props.value when
    // isBound=false (no binding path). Seeding state + $bindState + disabled
    // ensures the submitted value renders.
    state[field.key] = fieldValue;
    const boundValue = { $bindState: stateKey };
    const checks = !isReadOnly && field.required
      ? [{ type: "required", message: `${field.label} is required` }]
      : undefined

    const baseProps: Record<string, unknown> = {
      label: field.label,
      name: field.key,
      value: boundValue,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(isReadOnly && { disabled: true }),
      ...(checks && { checks, validateOn: "blur" }),
    };

    if (field.description) {
      const descriptionKey = `${elemKey}:description`;
      elements[descriptionKey] = { type: "Text", props: { text: field.description } };
      rootChildren.push(descriptionKey);
    }

    if (field.control === "choice") {
      elements[elemKey] = {
        type: "CheckpointChoiceField",
        props: {
          label: field.label,
          name: field.key,
          selection: field.selection ?? "single",
          options: (field.options ?? []).map((option) => ({ value: option, label: option })),
          value: boundValue,
          required: field.required,
        },
      };
    } else if (field.control === "boolean") {
      elements[elemKey] = { type: "Checkbox", props: { label: field.label, name: field.key, checked: boundValue } };
    } else if (field.control === "approval") {
      elements[elemKey] = {
        type: "Select",
        props: { ...baseProps, options: field.options ?? DEFAULT_APPROVAL_OPTIONS },
      };
    } else if (field.control === "select") {
      elements[elemKey] = {
        type: "Select",
        props: { ...baseProps, options: field.options ?? [] },
      };
    } else if (field.control === "textarea") {
      elements[elemKey] = { type: "Textarea", props: baseProps };
    } else {
      elements[elemKey] = { type: "Input", props: baseProps };
    }

    rootChildren.push(elemKey);
  }

  // Multi-checkpoint action selector
  const checkpointActions = actions.filter((a) => !a.executionAction);
  const hasMultipleCheckpoints = checkpointActions.length > 1;

  if (!isReadOnly && hasMultipleCheckpoints) {
    const primary = primaryAction(checkpointActions);
    state["__checkpointAction"] = primary?.checkpointAction ?? "";
    elements["action-select"] = {
      type: "Select",
      props: {
        label: "Action",
        name: "__checkpointAction",
        options: checkpointActions
          .map((a) => a.checkpointAction ?? a.id)
          .filter(Boolean) as string[],
        value: { $bindState: "/__checkpointAction" },
      },
    };
    rootChildren.push("action-select");
  }

  // Submit button
  if (!isReadOnly && actions.length > 0) {
    const primary = primaryAction(actions);
    if (primary) {
      const actionBinding = actionBindingFor(primary, hasMultipleCheckpoints);

      elements.submit = {
        type: "Button",
        props: {
          label: `Send ${primary.label}`,
          variant: primary.emphasis === "danger" ? "danger" : "primary",
          ...((disabledReason || disabledButton) && { disabled: true }),
        },
        on: { press: actionBinding }
      };
      rootChildren.push("submit");
    }
  }

  return {
    root: "root",
    elements,
    ...(Object.keys(state).length > 0 && { state }),
  };
}
