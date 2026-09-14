import type { ScheduleRecord } from "../../schedule-page-types";
import type {
  TaskConfigAiClient,
  TaskConfigFormInput,
} from "../../forms/task-config-form";

export interface SelectedBlockSheetProps {
  item: ScheduleRecord;
  selectedDay: string;
  availableAiClients?: TaskConfigAiClient[];
  isPending: boolean;
  onClose: () => void;
  onSaveTaskConfigAction: (
    item: ScheduleRecord,
    input: TaskConfigFormInput,
  ) => Promise<void>;
  onMutatedAction: () => Promise<void>;
  onDeleteTask?: (taskId: string) => void;
  buildScheduleHref: (day: string, taskId?: string) => string;
}
