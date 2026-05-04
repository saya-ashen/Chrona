import { TaskCreateDialog } from "@/components/schedule/task-create-dialog";
import type {
  SchedulePageData,
  ScheduleViewMode,
  TimelineCreateInput,
} from "@/components/schedule/schedule-page-types";
import type { SchedulePageViewModel } from "@/components/schedule/schedule-page-view-model";
import type { TaskPlanGraphResponse } from "@chrona/contracts/ai";

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
  handleApplyDecompositionFromDialog,
}: {
  showQuickAddDialog: boolean;
  isPending: boolean;
  dialogDefaults: {
    runtimeAdapterKey: string;
    runtimeInputVersion: string;
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
  handleApplyDecompositionFromDialog: (payload: {
    result: TaskPlanGraphResponse;
    title: string;
    description: string;
    priority: "Low" | "Medium" | "High" | "Urgent";
    dueAt: Date | null;
  }) => Promise<void>;
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
      onClose={onCloseQuickAdd}
      onSubmit={async (input) => {
        await handleCreateTaskBlock({
          title: input.title,
          description: input.description,
          priority: input.priority,
          dueAt: input.dueAt,
          runtimeAdapterKey: dialogDefaults.runtimeAdapterKey,
          runtimeInput: {},
          runtimeInputVersion: dialogDefaults.runtimeInputVersion,
          runtimeModel: null,
          prompt: null,
          runtimeConfig: null,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
        });
        onCloseQuickAdd();
      }}
      onApplyDecomposition={handleApplyDecompositionFromDialog}
    />
  );
}
