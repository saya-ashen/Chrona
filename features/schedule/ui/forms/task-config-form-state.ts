import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Control, UseFormGetValues, UseFormHandleSubmit, UseFormSetValue } from "react-hook-form";
import { deleteValueAtPath, setValueAtPath } from "@chrona/runtime-core";
import type { RuntimeInput, RuntimeTaskConfigField } from "@chrona/runtime-core";
import {
  buildDateTimeFromLocalParts,
  buildTaskConfigFormInput,
  cloneRuntimeInput,
  formatDurationLabel,
  isFieldVisible,
  readDisplayedFieldValue,
  resolveExecutionRuntime,
  toFormState,
} from "./task-config-form-conversions";
import type {
  TaskConfigCopy,
  TaskConfigDraftState,
  TaskConfigFormProps,
  TaskConfigFormState,
  TaskConfigInitialValues,
} from "./task-config-form-types";

const EMPTY_INITIAL_VALUES: TaskConfigInitialValues = {};

type TaskConfigFormStateOptions = Pick<
  TaskConfigFormProps,
  "executionRuntimes" | "defaultExecutionRuntime" | "initialValues" | "onDraftStateChange" | "onSubmitAction"
> & {
  copy: TaskConfigCopy;
};

export type TaskConfigFormView = {
  control: Control<TaskConfigFormState>;
  formState: TaskConfigFormState;
  getValues: UseFormGetValues<TaskConfigFormState>;
  handleSubmit: UseFormHandleSubmit<TaskConfigFormState>;
  localErrorMessage: string | null;
  optionalRuntimeFields: RuntimeTaskConfigField[];
  replaceFormState: (next: TaskConfigFormState) => void;
  requiredRuntimeFields: RuntimeTaskConfigField[];
  scheduleDurationLabel: string | null;
  selectedExecutionRuntime: ReturnType<typeof resolveExecutionRuntime>;
  setValue: UseFormSetValue<TaskConfigFormState>;
  submitForm: (values: TaskConfigFormState) => Promise<void>;
  updateRuntimeField: (field: RuntimeTaskConfigField, nextValue: unknown) => void;
  visibleStandardFields: RuntimeTaskConfigField[];
};

function useInitialFormState(
  initialValues: TaskConfigInitialValues | undefined,
  executionRuntimes: TaskConfigFormProps["executionRuntimes"],
  defaultExecutionRuntime: string,
) {
  const values = initialValues ?? EMPTY_INITIAL_VALUES;
  const {
    title,
    description,
    priority,
    dueAt,
    scheduledStartAt,
    scheduledEndAt,
    executionRuntime,
    executionConfig,
    aiClientId,
    autoPlanGeneration,
    autoExecute,
    autoPlanGenerationTiming,
    autoExecuteTiming,
    recurrenceRule,
  } = values;

  return useMemo(
    () => toFormState({
      title,
      description,
      priority,
      dueAt,
      scheduledStartAt,
      scheduledEndAt,
      executionRuntime,
      executionConfig,
      aiClientId,
      autoPlanGeneration,
      autoExecute,
      autoPlanGenerationTiming,
      autoExecuteTiming,
      recurrenceRule,
    }, executionRuntimes, defaultExecutionRuntime),
    [
      aiClientId,
      autoExecute,
      autoExecuteTiming,
      autoPlanGeneration,
      autoPlanGenerationTiming,
      defaultExecutionRuntime,
      description,
      dueAt,
      executionConfig,
      executionRuntime,
      executionRuntimes,
      priority,
      recurrenceRule,
      scheduledEndAt,
      scheduledStartAt,
      title,
    ],
  );
}

function useDraftStateNotification(
  formState: TaskConfigFormState,
  isDirty: boolean,
  executionRuntimes: TaskConfigFormProps["executionRuntimes"],
  copy: TaskConfigCopy,
  onDraftStateChange: ((state: TaskConfigDraftState) => void) | undefined,
) {
  useEffect(() => {
    if (!onDraftStateChange) return;

    const values = buildTaskConfigFormInput(formState, executionRuntimes, copy);
    if (values) onDraftStateChange({ isDirty, values });
  }, [copy, executionRuntimes, formState, isDirty, onDraftStateChange]);
}

function useRuntimeFields(
  executionRuntimes: TaskConfigFormProps["executionRuntimes"],
  defaultExecutionRuntime: string,
  formState: TaskConfigFormState,
) {
  const selectedExecutionRuntime = useMemo(
    () => resolveExecutionRuntime(executionRuntimes, formState.executionRuntime, defaultExecutionRuntime),
    [defaultExecutionRuntime, executionRuntimes, formState.executionRuntime],
  );
  const visibleExecutionConfig = useMemo(
    () => selectedExecutionRuntime.spec.fields.reduce<RuntimeInput>((runtimeInput, field) => {
      const value = readDisplayedFieldValue(field, formState.fieldExecutionConfig);
      if (value !== undefined) setValueAtPath(runtimeInput, field.path, value);
      return runtimeInput;
    }, cloneRuntimeInput(formState.fieldExecutionConfig)),
    [formState.fieldExecutionConfig, selectedExecutionRuntime.spec.fields],
  );
  const visibleStandardFields = selectedExecutionRuntime.spec.fields.filter(
    (field) => !field.advanced && isFieldVisible(field, visibleExecutionConfig),
  );
  const requiredRuntimeFields = visibleStandardFields.filter((field) =>
    selectedExecutionRuntime.spec.runnability.requiredPaths.includes(field.path),
  );
  const optionalRuntimeFields = visibleStandardFields.filter((field) =>
    !selectedExecutionRuntime.spec.runnability.requiredPaths.includes(field.path),
  );

  return { optionalRuntimeFields, requiredRuntimeFields, selectedExecutionRuntime, visibleStandardFields };
}

function useFormActions(
  getValues: UseFormGetValues<TaskConfigFormState>,
  setValue: UseFormSetValue<TaskConfigFormState>,
  executionRuntimes: TaskConfigFormProps["executionRuntimes"],
  copy: TaskConfigCopy,
  onSubmitAction: TaskConfigFormProps["onSubmitAction"],
) {
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);

  function updateRuntimeField(field: RuntimeTaskConfigField, nextValue: unknown) {
    const nextRuntimeInput = cloneRuntimeInput(getValues("fieldExecutionConfig"));
    if (nextValue === undefined) {
      deleteValueAtPath(nextRuntimeInput, field.path);
    } else {
      setValueAtPath(nextRuntimeInput, field.path, nextValue);
    }
    setValue("fieldExecutionConfig", nextRuntimeInput, { shouldDirty: true });
  }

  async function submitForm(values: TaskConfigFormState) {
    setLocalErrorMessage(null);
    try {
      const input = buildTaskConfigFormInput(values, executionRuntimes, copy, { throwOnInvalidJson: true });
      if (input) await onSubmitAction(input);
    } catch (error) {
      setLocalErrorMessage(error instanceof Error ? error.message : copy.actionFailed);
    }
  }

  return { localErrorMessage, submitForm, updateRuntimeField };
}

export function useTaskConfigFormState({
  executionRuntimes,
  defaultExecutionRuntime,
  initialValues,
  onDraftStateChange,
  onSubmitAction,
  copy,
}: TaskConfigFormStateOptions): TaskConfigFormView {
  const initialState = useInitialFormState(initialValues, executionRuntimes, defaultExecutionRuntime);
  const { control, reset, handleSubmit, setValue, getValues, formState: { isDirty } } = useForm<TaskConfigFormState>({
    defaultValues: initialState,
  });
  const formState = (useWatch({ control }) as TaskConfigFormState | undefined) ?? initialState;

  useEffect(() => {
    reset(initialState);
  }, [initialState, reset]);
  useDraftStateNotification(formState, isDirty, executionRuntimes, copy, onDraftStateChange);

  const runtimeFields = useRuntimeFields(executionRuntimes, defaultExecutionRuntime, formState);
  const scheduledStartAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledStartTime);
  const scheduledEndAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledEndTime);
  const scheduleDurationLabel = formatDurationLabel(scheduledStartAtPreview, scheduledEndAtPreview);
  const actions = useFormActions(getValues, setValue, executionRuntimes, copy, onSubmitAction);

  return {
    control,
    formState,
    getValues,
    handleSubmit,
    replaceFormState: (next) => reset(next, { keepDefaultValues: true }),
    scheduleDurationLabel,
    setValue,
    ...runtimeFields,
    ...actions,
  };
}
