interface CreateTaskInput {
  workspaceId: string;
  title: string;
  description?: string;
  priority?: string;
  executionRuntime?: string;
  executionConfig?: Record<string, unknown>;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: string;
  executionRuntime?: string;
  executionConfig?: Record<string, unknown>;
}

interface AutoCompleteInput {
  title: string;
  workspaceId?: string;
}

interface GenerateTaskPlanInput {
  taskId: string;
  forceRefresh?: boolean;
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

function buildQuery(
  query?: Record<string, string | number | undefined>,
): string {
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
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

      throw new Error(
        `${method} ${path} failed (${response.status}): ${message}`,
      );
    }

    return (await response.json()) as T;
  }

  listTasks(
    workspaceId: string,
    options: { status?: string; limit?: number } = {},
  ) {
    return this.request<unknown>(
      "GET",
      `/api/tasks${buildQuery({ workspaceId, status: options.status, limit: options.limit })}`,
    );
  }

  getTaskDetail(taskId: string) {
    return this.request<unknown>(
      "GET",
      `/api/tasks/${encodeURIComponent(taskId)}`,
    );
  }

  createTask(input: CreateTaskInput) {
    return this.request<unknown>("POST", "/api/tasks", input);
  }

  updateTask(taskId: string, input: UpdateTaskInput) {
    return this.request<unknown>(
      "PATCH",
      `/api/tasks/${encodeURIComponent(taskId)}`,
      input,
    );
  }

  deleteTask(taskId: string) {
    return this.request<unknown>(
      "DELETE",
      `/api/tasks/${encodeURIComponent(taskId)}`,
    );
  }

  markDone(taskId: string) {
    return this.request<unknown>(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/complete`,
    );
  }

  reopenTask(taskId: string) {
    return this.request<unknown>(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/reopen`,
    );
  }

  startExecution(taskId: string, prompt?: string) {
    return this.request<unknown>(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/execution/actions`,
      { action: "start_manual", prompt },
    );
  }

  sendMessage(taskId: string, message: string, runId?: string) {
    return this.request<unknown>(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/execution/actions`,
      {
        action: "resume_after_unblock",
        note: message,
        sessionId: runId,
      },
    );
  }

  submitExecutionInput(taskId: string, inputFields: Record<string, string>) {
    return this.request<unknown>(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/execution/actions`,
      {
        action: "resume_with_input",
        inputFields,
      },
    );
  }

  scheduleTask(
    taskId: string,
    scheduledStartAt: string,
    scheduledEndAt: string,
  ) {
    return this.request<unknown>(
      "PUT",
      `/api/tasks/${encodeURIComponent(taskId)}/schedule`,
      {
        scheduledStartAt,
        scheduledEndAt,
        scheduleSource: "human",
      },
    );
  }

  clearSchedule(taskId: string) {
    return this.request<unknown>(
      "DELETE",
      `/api/tasks/${encodeURIComponent(taskId)}/schedule`,
    );
  }

  getScheduleProjection(workspaceId: string) {
    return this.request<unknown>(
      "GET",
      `/api/schedule${buildQuery({ workspaceId })}`,
    );
  }

  autoComplete(input: AutoCompleteInput) {
    return this.request<unknown>("POST", "/api/ai/auto-complete", input);
  }

  async generateTaskPlan(input: GenerateTaskPlanInput) {
    const response = await fetch(
      `${this.baseUrl}/api/tasks/${encodeURIComponent(input.taskId)}/plan/generations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ forceRefresh: input.forceRefresh }),
      },
    );

    if (!response.ok) {
      let message = response.statusText;
      try {
        const errorBody = (await response.json()) as ApiErrorBody;
        message = errorBody.error ?? errorBody.message ?? message;
      } catch {
        // ignore invalid/non-json error bodies
      }

      throw new Error(
        `POST /api/tasks/${encodeURIComponent(input.taskId)}/plan/generations failed (${response.status}): ${message}`,
      );
    }

    if (!response.body) {
      throw new Error("Plan generation stream did not return a readable body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let finalResult: unknown = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
          continue;
        }

        if (!line.startsWith("data: ")) {
          continue;
        }

        const raw = line.slice(6).trim();
        const payload = raw ? JSON.parse(raw) : {};

        if (eventType === "result") {
          finalResult = payload;
        }

        if (eventType === "error") {
          throw new Error(
            typeof payload?.message === "string"
              ? payload.message
              : "Failed to generate task plan",
          );
        }
      }
    }

    if (!finalResult) {
      throw new Error(
        "Plan generation stream completed without a result event",
      );
    }

    return finalResult;
  }
}
