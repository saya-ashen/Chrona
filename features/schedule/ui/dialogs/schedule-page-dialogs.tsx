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

export function getScheduleQuickCreateTimes(day: Date | null | undefined) {
  const start = new Date(day ?? new Date());
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return { start, end };
}

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
  void activeView;
  void workspaceId;
  void routerPush;
  void locale;
  void localizeHref;
  void buildScheduleViewHref;
  void actionFailedMessage;

  const { start: initialStartAt, end: initialEndAt } =
    getScheduleQuickCreateTimes(viewModel.activeGroup?.date);

  return (
    <TaskCreateDialog
      isOpen={showQuickAddDialog}
      initialStartAt={initialStartAt}
      initialEndAt={initialEndAt}
      isPending={isPending}
      availableAiClients={availableAiClients ?? data.availableAiClients}
      executionRuntimes={data.executionRuntimes}
      defaultExecutionRuntime={dialogDefaults.executionRuntime}
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
          executionRuntime: input.executionRuntime,
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
