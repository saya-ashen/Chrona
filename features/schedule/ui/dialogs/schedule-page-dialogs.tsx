import { TaskCreateDialog } from "./task-create-dialog";
import type {
  SchedulePageData,
  ScheduleViewMode,
  TimelineCreateInput,
} from "../schedule-page-types";
import type { SchedulePageViewModel } from "../schedule-page-view-model";

export function SchedulePageDialogs({
  showQuickAddDialog,
  isPending,
  dialogDefaults,
  data,
  viewModel,
  activeView,
  workspaceId,
  routerPush,
  locale,
  localizeHref,
  buildScheduleViewHref,
  actionFailedMessage,
  onCloseQuickAdd,
  handleCreateTaskBlock,
  availableAiClients,
}: {
  showQuickAddDialog: boolean;
  isPending: boolean;
  dialogDefaults: {
    executionRuntime: string;
  };
  data: SchedulePageData;
  viewModel: SchedulePageViewModel;
  activeView: ScheduleViewMode;
  workspaceId: string;
  routerPush: (href: string) => void;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localizeHref: (locale: any, href: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
buildScheduleViewHref: (...args: any[]) => string;
  actionFailedMessage: string;
  onCloseQuickAdd: () => void;
  handleCreateTaskBlock: (input: TimelineCreateInput) => Promise<void>;
  availableAiClients?: SchedulePageData["availableAiClients"];
}) {

  void data;
  void viewModel;
  void activeView;
  void workspaceId;
  void routerPush;
  void locale;
  void localizeHref;
  void buildScheduleViewHref;
  void actionFailedMessage;

  return (
    <TaskCreateDialog
      isOpen={showQuickAddDialog}
      initialStartAt={new Date(new Date().setHours(9, 0, 0, 0))}
      initialEndAt={new Date(new Date().setHours(10, 0, 0, 0))}
      isPending={isPending}
      availableAiClients={availableAiClients ?? data.availableAiClients}
      onClose={onCloseQuickAdd}
      onSubmit={async (input) => {
        await handleCreateTaskBlock({
          title: input.title,
          description: input.description,
          priority: input.priority,
          autoExecute: input.autoExecute,
          autoPlanGenerationEnabled: input.autoPlanGenerationEnabled,
          autoPlanGenerationTiming: input.autoPlanGenerationTiming,
          autoExecuteTiming: input.autoExecuteTiming,
          dueAt: input.dueAt,
          executionRuntime: dialogDefaults.executionRuntime,
          executionConfig: {},
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
          recurrenceRule: input.recurrenceRule,
          recurrenceAnchorStartAt: input.recurrenceAnchorStartAt,
          recurrenceAnchorEndAt: input.recurrenceAnchorEndAt,
          aiClientId: input.aiClientId,
        });
        onCloseQuickAdd();
      }}
    />
  );
}
