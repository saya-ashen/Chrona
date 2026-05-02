export interface TaskChange {
  taskId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  priority?: string;
  dueAt?: string;
}

interface CreateTaskInput {
  workspaceId: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string;
  runtimeAdapterKey?: string;
  runtimeModel?: string;
  prompt?: string;
  runtimeConfig?: Record<string, unknown>;
}

interface CreateSubtaskInput {
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: string;
  dueAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  runtimeAdapterKey?: string;
  runtimeModel?: string;
  prompt?: string;
  runtimeConfig?: Record<string, unknown>;
}

interface AutoCompleteInput {
  title: string;
  workspaceId?: string;
}

interface GenerateTaskPlanInput {
  taskId?: string;
  title?: string;
  description?: string;
  estimatedMinutes?: number;
  planningPrompt?: string;
  forceRefresh?: boolean;
}

interface BatchApplyPlanInput {
  taskId: string;
  nodes?: unknown[];
  edges?: unknown[];
}

interface ApiErrorBody {
  error?: string;
  message?: string;
}

interface ClientConfig {
  baseUrl?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function buildQuery(query?: Record<string, string | number | undefined>): string {
  if (!query) return "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export class ApiClient {
  readonly baseUrl: string;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? "http://localhost:3101");
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const errorBody = (await response.json()) as ApiErrorBody;
        message = errorBody.error ?? errorBody.message ?? message;
      } catch {
        // ignore invalid/non-json error bodies
      }

      throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
    }

    return (await response.json()) as T;
  }

  listTasks(workspaceId: string, options: { status?: string; limit?: number } = {}) {
    return this.request<unknown>(
      "GET",
      `/api/tasks${buildQuery({ workspaceId, status: options.status, limit: options.limit })}`,
    );
  }

  getTask(taskId: string) {
    return this.request<unknown>("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
  }

  createTask(input: CreateTaskInput) {
    return this.request<unknown>("POST", "/api/tasks", input);
  }

  updateTask(taskId: string, input: UpdateTaskInput) {
    return this.request<unknown>("PATCH", `/api/tasks/${encodeURIComponent(taskId)}`, input);
  }

  deleteTask(taskId: string) {
    return this.request<unknown>("DELETE", `/api/tasks/${encodeURIComponent(taskId)}`);
  }

  markDone(taskId: string) {
    return this.request<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/done`);
  }

  reopenTask(taskId: string) {
    return this.request<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/reopen`);
  }

  listSubtasks(taskId: string) {
    return this.request<unknown>("GET", `/api/tasks/${encodeURIComponent(taskId)}/subtasks`);
  }

  createSubtask(taskId: string, input: CreateSubtaskInput) {
    return this.request<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/subtasks`, input);
  }

  startRun(taskId: string, prompt?: string) {
    return this.request<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/run`, prompt ? { prompt } : {});
  }

  sendMessage(taskId: string, message: string, runId?: string) {
    return this.request<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/message`, {
      message,
      runId,
    });
  }

  provideInput(taskId: string, inputText: string, runId?: string) {
    return this.request<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/input`, {
      inputText,
      runId,
    });
  }

  scheduleTask(taskId: string, scheduledStartAt: string, scheduledEndAt: string) {
    return this.request<unknown>("POST", `/api/tasks/${encodeURIComponent(taskId)}/schedule`, {
      scheduledStartAt,
      scheduledEndAt,
    });
  }

  clearSchedule(taskId: string) {
    return this.request<unknown>("DELETE", `/api/tasks/${encodeURIComponent(taskId)}/schedule`);
  }

  getScheduleProjection(workspaceId: string) {
    return this.request<unknown>(
      "GET",
      `/api/schedule/projection${buildQuery({ workspaceId })}`,
    );
  }

  analyzeConflicts(workspaceId: string, date?: string) {
    return this.request<unknown>("POST", "/api/ai/analyze-conflicts", { workspaceId, date });
  }

  suggestTimeslot(workspaceId: string, taskId: string, date?: string) {
    return this.request<unknown>("POST", "/api/ai/suggest-timeslot", { workspaceId, taskId, date });
  }

  suggestAutomation(taskId?: string, input?: Record<string, unknown>) {
    return this.request<unknown>("POST", "/api/ai/suggest-automation", taskId ? { taskId } : input ?? {});
  }

  applySuggestion(workspaceId: string, suggestionId: string, changes: TaskChange[]) {
    return this.request<unknown>("POST", "/api/ai/apply-suggestion", {
      workspaceId,
      suggestionId,
      changes,
    });
  }

  autoComplete(input: AutoCompleteInput) {
    return this.request<unknown>("POST", "/api/ai/auto-complete", input);
  }

  generateTaskPlan(input: GenerateTaskPlanInput) {
    return this.request<unknown>("POST", "/api/ai/generate-task-plan", input);
  }

  batchApplyPlan(input: BatchApplyPlanInput) {
    return this.request<unknown>("POST", "/api/ai/batch-apply-plan", input);
  }

  getAiStatus() {
    return this.request<unknown>("GET", "/api/ai/status");
  }
}








