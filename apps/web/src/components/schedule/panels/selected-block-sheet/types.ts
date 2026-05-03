import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import type {
  TaskConfigFormInput,
  TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";

export interface SelectedBlockSheetProps {
  item: ScheduledItem;
  selectedDay: string;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
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
