"use client";

import { buttonVariants } from "@/components/ui/button";
import {
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";

type EditableTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
};

type Props = {
  task: EditableTask;
  originalTask: EditableTask;
  onChange: (field: string, value: string | null) => void;
  onSave: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  copy: Record<string, string>;
};

function formatLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 16);
}

function parseLocalDatetime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new Date(trimmed).toISOString();
  } catch {
    return null;
  }
}

function formatJson(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function inputClass() {
  return "w-full rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[13px] outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50";
}

export function TaskEditForm({
  task,
  originalTask,
  onChange,
  onSave,
  isSaving,
  saveError,
  saveSuccess,
  copy,
}: Props) {
  const hasChanges =
    task.title !== originalTask.title ||
    task.description !== originalTask.description ||
    task.priority !== originalTask.priority ||
    task.dueAt !== originalTask.dueAt ||
    task.scheduledStartAt !== originalTask.scheduledStartAt ||
    task.scheduledEndAt !== originalTask.scheduledEndAt ||
    task.scheduleStatus !== originalTask.scheduleStatus ||
    task.runtimeModel !== originalTask.runtimeModel ||
    task.prompt !== originalTask.prompt ||
    JSON.stringify(task.runtimeConfig) !== JSON.stringify(originalTask.runtimeConfig);

  return (
    <div className="space-y-3">
      <SurfaceCardHeader>
        <SurfaceCardTitle>{copy.taskEditorTitle ?? "Task Information"}</SurfaceCardTitle>
        <SurfaceCardDescription>
          {copy.taskEditorDescription ?? "Edit the core task fields."}
        </SurfaceCardDescription>
      </SurfaceCardHeader>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <FieldGroup label="Title">
          <input
            type="text"
            value={task.title}
            onChange={(e) => onChange("title", e.target.value || null)}
            className={inputClass()}
            placeholder="Task title"
          />
        </FieldGroup>

        <FieldGroup label="Priority">
          <select
            value={task.priority}
            onChange={(e) => onChange("priority", e.target.value)}
            className={cn(inputClass(), "cursor-pointer")}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Urgent">Urgent</option>
          </select>
        </FieldGroup>

        <FieldGroup label="Schedule">
          <select
            value={task.scheduleStatus}
            onChange={(e) => onChange("scheduleStatus", e.target.value)}
            className={cn(inputClass(), "cursor-pointer")}
          >
            <option value="Unscheduled">Unscheduled</option>
            <option value="Scheduled">Scheduled</option>
            <option value="InProgress">InProgress</option>
            <option value="AtRisk">AtRisk</option>
            <option value="Interrupted">Interrupted</option>
            <option value="Overdue">Overdue</option>
            <option value="Completed">Completed</option>
          </select>
        </FieldGroup>

        <FieldGroup label="Model">
          <input
            type="text"
            value={task.runtimeModel ?? ""}
            onChange={(e) => onChange("runtimeModel", e.target.value || null)}
            className={inputClass()}
            placeholder="e.g. gpt-4o"
          />
        </FieldGroup>

        <FieldGroup label="Due">
          <input
            type="datetime-local"
            value={formatLocalDatetime(task.dueAt)}
            onChange={(e) => onChange("dueAt", parseLocalDatetime(e.target.value))}
            className={cn(inputClass(), "cursor-pointer")}
          />
        </FieldGroup>

        <FieldGroup label="Start">
          <input
            type="datetime-local"
            value={formatLocalDatetime(task.scheduledStartAt)}
            onChange={(e) => onChange("scheduledStartAt", parseLocalDatetime(e.target.value))}
            className={cn(inputClass(), "cursor-pointer")}
          />
        </FieldGroup>

        <FieldGroup label="End">
          <input
            type="datetime-local"
            value={formatLocalDatetime(task.scheduledEndAt)}
            onChange={(e) => onChange("scheduledEndAt", parseLocalDatetime(e.target.value))}
            className={cn(inputClass(), "cursor-pointer")}
          />
        </FieldGroup>
      </div>

      <details className="group space-y-2">
        <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors select-none">
          Description & Prompt
        </summary>
        <div className="space-y-2 pt-1">
          <FieldGroup label="Description">
            <textarea
              value={task.description ?? ""}
              onChange={(e) => onChange("description", e.target.value || null)}
              className={cn(inputClass(), "resize-y min-h-[60px] font-mono text-xs")}
              placeholder="Task description..."
              rows={2}
            />
          </FieldGroup>

          <FieldGroup label="Prompt">
            <textarea
              value={task.prompt ?? ""}
              onChange={(e) => onChange("prompt", e.target.value || null)}
              className={cn(inputClass(), "resize-y min-h-[60px] font-mono text-xs")}
              placeholder="System prompt for AI execution..."
              rows={3}
            />
          </FieldGroup>

          <FieldGroup label="Runtime Config (JSON)">
            <textarea
              value={formatJson(task.runtimeConfig)}
              onChange={(e) => {
                const val = e.target.value.trim();
                if (!val) {
                  onChange("runtimeConfig", null);
                  return;
                }
                try {
                  const parsed = JSON.parse(val);
                  onChange("runtimeConfig", parsed);
                } catch {
                  // Keep current value while typing invalid JSON
                }
              }}
              className={cn(inputClass(), "resize-y min-h-[60px] font-mono text-xs")}
              placeholder='{"key": "value"}'
              rows={3}
            />
          </FieldGroup>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !hasChanges}
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            (!hasChanges || isSaving) && "opacity-50 cursor-not-allowed",
          )}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>

        {saveSuccess ? (
          <span className="text-xs text-emerald-600 font-medium">Saved successfully</span>
        ) : null}

        {saveError ? (
          <span className="text-xs text-red-600">{saveError}</span>
        ) : null}
      </div>
    </div>
  );
}
