import { useCallback, useEffect, useMemo, useState } from "react";
import type { CheckpointInputFields, ExecutionActionInput, SubmitCheckpointActionInput } from "@chrona/contracts";
import { buildActionSpec, type ActionItemInput } from "@chrona/ui-protocol";
import {
  actionKindForNode,
  buildWorkspaceCheckpointActionInput,
  getWorkspaceActionDisabledReason,
  SpecRenderer,
  type PlanNodeDataModel,
  type TaskExecutionDispatchResult,
} from "@features/task-workspace";

function isTerminalStatus(status: PlanNodeDataModel["status"]) {
  return status === "done" || status === "skipped";
}

function submittedInputFields(inputFields: PlanNodeDataModel["inputFields"]): CheckpointInputFields | undefined {
  return inputFields;
}

function hasSubmittedInputFields(inputFields: PlanNodeDataModel["inputFields"]) {
  return Boolean(inputFields && Object.values(inputFields).some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "boolean" ? true : value.trim().length > 0,
  ));
}

export function useActionSpecRenderConfig({
  node,
  disabledActionReason,
  onDispatchExecutionAction,
  onSubmitCheckpointAction,
}: {
  node: PlanNodeDataModel | null;
  disabledActionReason?: string;
  onDispatchExecutionAction?: (action: ExecutionActionInput) => Promise<TaskExecutionDispatchResult>;
  onSubmitCheckpointAction?: (action: SubmitCheckpointActionInput) => Promise<TaskExecutionDispatchResult>;
}) {
  const fields = useMemo(() => node?.interactiveFields ?? [], [node?.interactiveFields]);
  const isReadOnly = Boolean(node && isTerminalStatus(node.status) && hasSubmittedInputFields(node.inputFields));

  // Track current values of required fields so we can disable the submit button
  // when any are empty — mirrors the legacy getWorkspaceActionDisabledReason gate.
  const [requiredFieldValues, setRequiredFieldValues] = useState<CheckpointInputFields>(() =>
    Object.fromEntries(fields.filter((field) => field.required).map((field) => [field.key, field.value])),
  );
  useEffect(() => {
    setRequiredFieldValues(
      Object.fromEntries(fields.filter((field) => field.required).map((field) => [field.key, field.value])),
    );
  }, [fields]);
  const actionDisabledReason = useMemo(
    () => getWorkspaceActionDisabledReason({ fields, values: requiredFieldValues, isDispatching: false, baseReason: disabledActionReason }),
    [disabledActionReason, fields, requiredFieldValues],
  );
  const handleStateChange = useCallback((changes: Array<{ path: string; value: unknown }>) => {
    setRequiredFieldValues((prev) => {
      let changed = false;
      const updates: CheckpointInputFields = {};
      for (const { path, value } of changes) {
        const key = path.startsWith("/") ? path.slice(1) : path;
        if (key in prev && (typeof value === "string" || typeof value === "boolean" || (Array.isArray(value) && value.every((item) => typeof item === "string")))) {
          if (JSON.stringify(prev[key]) !== JSON.stringify(value)) { updates[key] = value; changed = true; }
        }
      }
      return changed ? { ...prev, ...updates } : prev;
    });
  }, []);

  const normalizedActions: ActionItemInput[] = useMemo(() => {
    const avail = node?.availableActions ?? [];
    if (avail.length > 0) {
      return avail.map((a) => ({
        id: a.id,
        label: a.label,
        kind: a.kind,
        emphasis: a.emphasis,
        checkpointId: a.checkpointId,
        checkpointAction: a.checkpointAction,
        executionAction: a.executionAction as Record<string, unknown> | undefined,
      }));
    }
    // Synthesize a default checkpoint action when there are interactive fields
    // but no explicit availableActions (mirrors the null-selectedAction path in
    // the legacy component where buildWorkspaceCheckpointActionInput falls back
    // to node.checkpoint?.id and actionKindForNode).
    if (node && fields.length > 0 && node.checkpoint) {
      return [{
        id: "__default",
        label: "input",
        kind: "input",
        checkpointId: node.checkpoint.id,
        checkpointAction: actionKindForNode(node, null) ?? "submit_input",
      }];
    }
    return [];
  }, [node, fields]);

  const spec = useMemo(() => node ? buildActionSpec({
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      control: field.control,
      required: field.required,
      options: field.options,
      selection: field.selection,
    })),
    actions: normalizedActions,
    submittedValues: submittedInputFields(node.inputFields),
    isReadOnly,
    nodeNextAction: node.nextAction,
    disabledReason: actionDisabledReason ?? undefined,
    disabledButton: !isReadOnly && Boolean(actionDisabledReason),
  }) : null, [fields, normalizedActions, isReadOnly, node, actionDisabledReason]);

  const handlers = useMemo(() => ({
    "dispatch-execution": async (params: Record<string, unknown>) => {
      if (!node) throw new Error("Execution action node not found.");
      const actionId = params.actionId as string;
      const found = node.availableActions?.find((a) => a.id === actionId);
      if (!found?.executionAction) throw new Error("Execution action not found.");
      if (!onDispatchExecutionAction) throw new Error("Execution actions are not available for this view.");
      const result = await onDispatchExecutionAction(found.executionAction);
      return result.message;
    },
    "submit-checkpoint": async (params: Record<string, unknown>) => {
      if (!node) throw new Error("Checkpoint action node not found.");
      const checkpointAction = params.checkpointAction as string | undefined;
      const actionId = params.actionId as string | undefined;
      const rawValues = (params.values ?? {}) as Record<string, unknown>;
      const values = Object.fromEntries(
        fields.flatMap((field) => {
          const value = rawValues[field.key];
          return typeof value === "string" || typeof value === "boolean" || (Array.isArray(value) && value.every((item) => typeof item === "string"))
            ? [[field.key, value] as const]
            : [];
        }),
      ) as CheckpointInputFields;
      const selectedAction = node.availableActions?.find((a) => a.checkpointAction === checkpointAction || a.id === actionId) ?? null;
      if (!onSubmitCheckpointAction) throw new Error("Checkpoint actions are not available for this view.");
      const result = await onSubmitCheckpointAction(
        buildWorkspaceCheckpointActionInput({ node, selectedAction, fields, values }),
      );
      return result.message;
    },
  }), [node, fields, onDispatchExecutionAction, onSubmitCheckpointAction]);

  return { spec, handlers, onStateChange: handleStateChange };
}

export function ActionTab(props: Parameters<typeof useActionSpecRenderConfig>[0]) {
  const { spec, handlers, onStateChange } = useActionSpecRenderConfig(props);
  return <SpecRenderer spec={spec} handlers={handlers} onStateChange={onStateChange} />;
}
