import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Control, UseFormGetValues, UseFormHandleSubmit, UseFormSetValue } from "react-hook-form";
import {
  buildDateTimeFromLocalParts,
  buildTaskConfigFormInput,
  formatDurationLabel,
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
  "initialValues" | "onDraftStateChange" | "onSubmitAction"
> & {
  copy: TaskConfigCopy;
};

export type TaskConfigFormView = {
  control: Control<TaskConfigFormState>;
  formState: TaskConfigFormState;
  getValues: UseFormGetValues<TaskConfigFormState>;
  handleSubmit: UseFormHandleSubmit<TaskConfigFormState>;
  localErrorMessage: string | null;
  replaceFormState: (next: TaskConfigFormState) => void;
  scheduleDurationLabel: string | null;
  setValue: UseFormSetValue<TaskConfigFormState>;
  submitForm: (values: TaskConfigFormState) => Promise<void>;
};

function useInitialFormState(initialValues: TaskConfigInitialValues | undefined) {
  const values = initialValues ?? EMPTY_INITIAL_VALUES;
  const {
    title,
    description,
    priority,
    dueAt,
    scheduledStartAt,
    scheduledEndAt,
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
      executionConfig,
      aiClientId,
      autoPlanGeneration,
      autoExecute,
      autoPlanGenerationTiming,
      autoExecuteTiming,
      recurrenceRule,
    }),
    [
      aiClientId,
      autoExecute,
      autoExecuteTiming,
      autoPlanGeneration,
      autoPlanGenerationTiming,
      description,
      dueAt,
      executionConfig,
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
  copy: TaskConfigCopy,
  onDraftStateChange: ((state: TaskConfigDraftState) => void) | undefined,
) {
  useEffect(() => {
    if (!onDraftStateChange) return;
    const values = buildTaskConfigFormInput(formState, copy);
    if (values) onDraftStateChange({ isDirty, values });
  }, [copy, formState, isDirty, onDraftStateChange]);
}

function useFormActions(
  copy: TaskConfigCopy,
  onSubmitAction: TaskConfigFormProps["onSubmitAction"],
) {
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);

  async function submitForm(values: TaskConfigFormState) {
    setLocalErrorMessage(null);
    try {
      const input = buildTaskConfigFormInput(values, copy, { throwOnInvalidJson: true });
      if (input) await onSubmitAction(input);
    } catch (error) {
      setLocalErrorMessage(error instanceof Error ? error.message : copy.actionFailed);
    }
  }

  return { localErrorMessage, submitForm };
}

export function useTaskConfigFormState({
  initialValues,
  onDraftStateChange,
  onSubmitAction,
  copy,
}: TaskConfigFormStateOptions): TaskConfigFormView {
  const initialState = useInitialFormState(initialValues);
  const { control, reset, handleSubmit, setValue, getValues, formState: { isDirty } } = useForm<TaskConfigFormState>({
    defaultValues: initialState,
  });
  const formState = (useWatch({ control }) as TaskConfigFormState | undefined) ?? initialState;

  useEffect(() => {
    reset(initialState);
  }, [initialState, reset]);
  useDraftStateNotification(formState, isDirty, copy, onDraftStateChange);

  const scheduledStartAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledStartTime);
  const scheduledEndAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledEndTime);
  const scheduleDurationLabel = formatDurationLabel(scheduledStartAtPreview, scheduledEndAtPreview);
  const actions = useFormActions(copy, onSubmitAction);

  return {
    control,
    formState,
    getValues,
    handleSubmit,
    replaceFormState: (next) => reset(next, { keepDefaultValues: true }),
    scheduleDurationLabel,
    setValue,
    ...actions,
  };
}
