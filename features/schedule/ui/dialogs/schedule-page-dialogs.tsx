import { TaskCreateDialog } from "./task-create-dialog";
import type {
  SchedulePageData,
  ScheduleViewMode,
  TimelineCreateInput,
} from "../schedule-page-types";
import type { SchedulePageViewModel } from "../schedule-page-view-model";
import type { Locale } from "@chrona/i18n";

type ScheduleViewHrefBuilder = (
  day: string,
  view: ScheduleViewMode,
  taskId?: string,
) => string;

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
  locale: Locale;
  localizeHref: (locale: Locale | undefined, href: string) => string;
  buildScheduleViewHref: ScheduleViewHrefBuilder;
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
