import type { ScheduleRecord } from "../../schedule-page-types";
import type {
  TaskConfigAiClient,
  TaskConfigExecutionRuntime,
  TaskConfigFormInput,
} from "../../forms/task-config-form";

export interface SelectedBlockSheetProps {
  item: ScheduleRecord;
  selectedDay: string;
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  availableAiClients?: TaskConfigAiClient[];
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
