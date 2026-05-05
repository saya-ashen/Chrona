"use client";

import {
  Calendar,
  ChevronDown,
  GripVertical,
  Trash2,
} from "lucide-react";
import { type DragEvent, useState } from "react";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type {
  UnscheduledItem,
} from "@/components/schedule/schedule-page-types";
import {
  formatDateTime,
  getPriorityAccent,
  getPriorityTone,
  toTaskConfigInitialValues,
} from "@/components/schedule/schedule-page-utils";
import { TimeslotSuggestionPanel } from "@/components/schedule/timeslot-suggestion-panel";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { TaskContextLinks } from "@/components/task/shared/task-context-links";
import type { ScheduleSlot } from "@chrona/contracts/ai";
import { useI18n, useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

export { DayTimelineSummary } from "./schedule-panel-primitives";
export { SelectedBlockSheet } from "./selected-block-sheet";

function QueueTaskConfigEditor({
  item,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onSaveTaskConfigAction,
}: {
  item: UnscheduledItem;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
}) {
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);

  return (
    <TaskConfigForm
      runtimeAdapters={runtimeAdapters}
      defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
      isPending={isPending}
      initialValues={toTaskConfigInitialValues(item)}
      submitLabel={copy.saveTaskConfig}
      pendingLabel={copy.saving}
      onSubmitAction={(input) => onSaveTaskConfigAction(item.taskId, input)}
    />
  );
}

function getQueueSuggestedDuration(item: UnscheduledItem) {
  const value = (
    item.runtimeConfig as { suggestedDurationMinutes?: unknown } | null
  )?.suggestedDurationMinutes;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(15, Math.round(value / 15) * 15);
}

export function QueueCard({
  item,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isDragging,
  isPending,
  isExpanded,
  currentSchedule,
  onToggle,
  onMutatedAction,
  onSaveTaskConfigAction,
  onScheduleSlot,
  onDeleteTask,
  onDragStart,
  onDragEnd,
}: {
  item: UnscheduledItem;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isDragging: boolean;
  isPending: boolean;
  isExpanded: boolean;
  currentSchedule?: ScheduleSlot[];
  onToggle: () => void;
  onMutatedAction: () => Promise<void>;
  onSaveTaskConfigAction: (
    taskId: string,
    input: TaskConfigFormInput,
  ) => Promise<void>;
  onScheduleSlot?: (taskId: string, startAt: Date, endAt: Date) => void;
  onDeleteTask?: (taskId: string) => void;
  onDragStart: (item: UnscheduledItem, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
  const suggestedDurationMinutes = getQueueSuggestedDuration(item);
  const [showTimeslots, setShowTimeslots] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const accent = getPriorityAccent(item.priority);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white/98 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-colors",
        isDragging && "border-primary/40 bg-primary/5",
        !isDragging && "border-border",
      )}
    >
      <div
        draggable={!isPending}
        aria-label={`Drag ${item.title} to the timeline`}
        onDragStart={(event) => onDragStart(item, event)}
        onDragEnd={onDragEnd}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 cursor-grab active:cursor-grabbing select-none",
          isPending && "cursor-not-allowed opacity-60",
        )}
      >
        <div className={`w-1 shrink-0 self-stretch rounded-full ${accent}`} />

        <GripVertical className="size-3.5 text-muted-foreground/30 shrink-0" aria-hidden="true" />

        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{item.title}</span>
          <StatusBadge tone={getPriorityTone(item.priority)} className="text-[10px] px-1.5 py-0.5">
            {item.priority}
          </StatusBadge>
          {item.dueAt ? (
            <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
              {formatDateTime(item.dueAt, locale)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {suggestedDurationMinutes ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowTimeslots((v) => !v); }}
              className={cn(
                "rounded-md p-1 transition-colors",
                showTimeslots ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-foreground",
              )}
              title="Suggest time slot"
            >
              <Calendar className="size-3.5" />
            </button>
          ) : null}
          {onDeleteTask ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm((v) => !v); }}
              className={cn(
                "rounded-md p-1 transition-colors",
                showDeleteConfirm ? "text-red-500 bg-red-50" : "text-muted-foreground/50 hover:text-red-500",
              )}
              title="Delete task"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <ChevronDown className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {showDeleteConfirm ? (
        <div className="border-t border-red-100 bg-red-50/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] text-red-600">Delete "{item.title}"?</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDeleteTask?.(item.taskId); }}
              className="rounded-md bg-red-500 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {isExpanded ? (
        <div className="border-t border-border/60 px-3 py-3 space-y-3">
          {item.actionRequired ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {item.actionRequired}
            </div>
          ) : null}

          {showTimeslots && suggestedDurationMinutes ? (
            <TimeslotSuggestionPanel
              taskId={item.taskId}
              title={item.title}
              priority={item.priority}
              estimatedMinutes={suggestedDurationMinutes}
              dueAt={item.dueAt}
              currentSchedule={currentSchedule ?? []}
              onSchedule={(startAt, endAt) => onScheduleSlot?.(item.taskId, startAt, endAt)}
            />
          ) : null}

          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Schedule
            </p>
            <ScheduleEditorForm
              taskId={item.taskId}
              dueAt={item.dueAt}
              allowClear={false}
              submitLabel={copy.scheduleTask}
              onMutatedAction={onMutatedAction}
            />
          </div>

          <details className="group">
            <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors select-none">
              Task config & links
            </summary>
            <div className="mt-2 space-y-2">
              <QueueTaskConfigEditor
                item={item}
                runtimeAdapters={runtimeAdapters}
                defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                isPending={isPending}
                onSaveTaskConfigAction={onSaveTaskConfigAction}
              />
              <TaskContextLinks
                workspaceId={item.workspaceId}
                taskId={item.taskId}
                latestRunStatus={item.latestRunStatus}
                workLabel="Open Workbench"
              />
            </div>
          </details>
         </div>
      ) : null}
    </div>
  );
}
