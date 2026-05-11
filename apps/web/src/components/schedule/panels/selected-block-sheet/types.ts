import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import type {
  TaskConfigExecutionRuntime,
  TaskConfigFormInput,
} from "@/components/schedule/forms/task-config-form";

export interface SelectedBlockSheetProps {
  item: ScheduledItem;
  selectedDay: string;
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  isPending: boolean;
  onClose: () => void;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
  onMutatedAction: () => Promise<void>;
  onDeleteTask?: (taskId: string) => void;
  buildScheduleHref: (day: string, taskId?: string) => string;
}
