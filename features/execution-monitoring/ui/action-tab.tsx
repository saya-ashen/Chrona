import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExecutionActionInput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { buildActionSpec, type ActionItemInput } from "@chrona/ui-protocol";
import type { PlanNodeDataModel } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import {
  actionKindForNode,
  buildWorkspaceCheckpointActionInput,
  getWorkspaceActionDisabledReason,
  type TaskExecutionDispatchResult,
} from "../../task-workspace";
import { SpecRenderer } from "../../../apps/web/src/components/tasks/workspace/catalog/spec-renderer";

function isTerminalStatus(status: PlanNodeDataModel["status"]) {
  return status === "done" || status === "skipped";
}

function hasSubmittedInputFields(inputFields: Record<string, string> | undefined) {
  return Boolean(inputFields && Object.values(inputFields).some((value) => value.trim()));
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
  const [requiredFieldValues, setRequiredFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.required).map((f) => [f.key, f.value])),
  );
  useEffect(() => {
    setRequiredFieldValues(
      Object.fromEntries(fields.filter((f) => f.required).map((f) => [f.key, f.value])),
    );
  }, [fields]);
  const actionDisabledReason = useMemo(
    () => getWorkspaceActionDisabledReason({ fields, values: requiredFieldValues, isDispatching: false, baseReason: disabledActionReason }),
    [disabledActionReason, fields, requiredFieldValues],
  );
  const handleStateChange = useCallback((changes: Array<{ path: string; value: unknown }>) => {
    setRequiredFieldValues((prev) => {
      let changed = false;
      const updates: Record<string, string> = {};
      for (const { path, value } of changes) {
        const key = path.startsWith("/") ? path.slice(1) : path;
        if (key in prev) {
          const str = typeof value === "string" ? value : "";
          if (prev[key] !== str) { updates[key] = str; changed = true; }
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
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      value: f.value,
      control: f.control,
      required: f.required,
      options: f.options,
    })),
    actions: normalizedActions,
    submittedValues: node.inputFields,
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
      // Strip non-string entries (e.g. $bindState refs that were not resolved) for defense-in-depth.
      const values = Object.fromEntries(
        Object.entries(rawValues).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
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
