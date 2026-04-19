/**
 * HTTP API client for AgentDashboard backend.
 * Uses native fetch to communicate with the Next.js API routes.
 * Covers ALL backend endpoints for comprehensive CLI access.
 */

export interface TaskChange {
  taskId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  priority?: string;
  dueAt?: string;
}

export interface CreateTaskBody {
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

export interface CreateSubtaskBody {
  title: string;
  description?: string;
  priority?: string;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  priority?: string;
  dueAt?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  runtimeModel?: string;
  prompt?: string;
}

export interface ApiError {
  error: string;
}

export class ApiClient {
  constructor(public readonly baseUrl: string = "http://localhost:3000") {}

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      let message: string;
      try {
        const errorBody = (await response.json()) as ApiError;
        message = errorBody.error ?? response.statusText;
      } catch {
        message = response.statusText;
      }
      throw new Error(
        `API ${method} ${path} failed (${response.status}): ${message}`,
      );
    }

    return (await response.json()) as T;
  }

  // ── Task CRUD ──────────────────────────────────────────────────────

  /**
   * List tasks for a workspace.
   * GET /api/tasks?workspaceId=xxx&status=xxx&limit=50
   */
  async listTasks(
    workspaceId: string,
    options?: { status?: string; limit?: number },
  ): Promise<unknown> {
    const params = new URLSearchParams({ workspaceId });
    if (options?.status) params.set("status", options.status);
    if (options?.limit) params.set("limit", String(options.limit));
    return this.request("GET", `/api/tasks?${params.toString()}`);
  }

  /**
   * Create a new task.
   * POST /api/tasks
   */
  async createTask(body: CreateTaskBody): Promise<unknown> {
    return this.request("POST", "/api/tasks", body);
  }

  /**
   * Get a single task by ID.
   * GET /api/tasks/[taskId]
   */
  async getTask(taskId: string): Promise<unknown> {
    return this.request("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * Update a task.
   * PATCH /api/tasks/[taskId]
   */
  async updateTask(taskId: string, body: UpdateTaskBody): Promise<unknown> {
    return this.request(
      "PATCH",
      `/api/tasks/${encodeURIComponent(taskId)}`,
      body,
    );
  }

  // ── Task Actions ───────────────────────────────────────────────────

  /**
   * Start a run for a task.
   * POST /api/tasks/[taskId]/run
   */
  async startRun(taskId: string, prompt?: string): Promise<unknown> {
    const body: Record<string, string> = {};
    if (prompt) body.prompt = prompt;
    return this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/run`,
      body,
    );
  }

  /**
   * Schedule a task.
   * POST /api/tasks/[taskId]/schedule
   */
  async scheduleTask(
    taskId: string,
    scheduledStartAt: string,
    scheduledEndAt: string,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/schedule`,
      { scheduledStartAt, scheduledEndAt },
    );
  }

  /**
   * Clear a task's schedule.
   * DELETE /api/tasks/[taskId]/schedule
   */
  async clearSchedule(taskId: string): Promise<unknown> {
    return this.request(
      "DELETE",
      `/api/tasks/${encodeURIComponent(taskId)}/schedule`,
    );
  }

  /**
   * Delete a task.
   * DELETE /api/tasks/[taskId]
   */
  async deleteTask(taskId: string): Promise<unknown> {
    return this.request(
      "DELETE",
      `/api/tasks/${encodeURIComponent(taskId)}`,
    );
  }

  /**
   * List subtasks of a task.
   * GET /api/tasks/[taskId]/subtasks
   */
  async listSubtasks(taskId: string): Promise<unknown> {
    return this.request(
      "GET",
      `/api/tasks/${encodeURIComponent(taskId)}/subtasks`,
    );
  }

  /**
   * Create a subtask under a parent task.
   * POST /api/tasks/[taskId]/subtasks
   */
  async createSubtask(
    taskId: string,
    body: CreateSubtaskBody,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/subtasks`,
      body,
    );
  }

  /**
   * Mark a task as done.
   * POST /api/tasks/[taskId]/done
   */
  async markDone(taskId: string): Promise<unknown> {
    return this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/done`,
    );
  }

  /**
   * Reopen a completed task.
   * POST /api/tasks/[taskId]/reopen
   */
  async reopenTask(taskId: string): Promise<unknown> {
    return this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/reopen`,
    );
  }

  /**
   * Send a message to a running task.
   * POST /api/tasks/[taskId]/message
   */
  async sendMessage(taskId: string, message: string): Promise<unknown> {
    return this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/message`,
      { message },
    );
  }

  /**
   * Provide input to a task waiting for input.
   * POST /api/tasks/[taskId]/input
   */
  async provideInput(taskId: string, inputText: string): Promise<unknown> {
    return this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/input`,
      { inputText },
    );
  }

  // ── AI Endpoints ───────────────────────────────────────────────────

  /**
   * Analyze scheduling conflicts for a workspace.
   * POST /api/ai/analyze-conflicts
   */
  async analyzeConflicts(
    workspaceId: string,
    date?: string,
  ): Promise<unknown> {
    const body: Record<string, string> = { workspaceId };
    if (date) body.date = date;
    return this.request("POST", "/api/ai/analyze-conflicts", body);
  }

  /**
   * Get automation suggestions for a task.
   * POST /api/ai/suggest-automation
   */
  async suggestAutomation(taskId: string): Promise<unknown> {
    return this.request("POST", "/api/ai/suggest-automation", { taskId });
  }

  /**
   * Apply a scheduling suggestion.
   * POST /api/ai/apply-suggestion
   */
  async applySuggestion(
    workspaceId: string,
    suggestionId: string,
    changes: TaskChange[],
  ): Promise<unknown> {
    return this.request("POST", "/api/ai/apply-suggestion", {
      workspaceId,
      suggestionId,
      changes,
    });
  }

  /**
   * Decompose a task into subtasks.
   * POST /api/ai/decompose-task
   */
  async decomposeTask(taskId: string): Promise<unknown> {
    return this.request("POST", "/api/ai/decompose-task", { taskId });
  }

  /**
   * Batch-decompose a task: decompose and create subtasks in one step.
   * POST /api/ai/batch-decompose
   */
  async batchDecompose(taskId: string): Promise<unknown> {
    return this.request("POST", "/api/ai/batch-decompose", { taskId });
  }

  /**
   * Get title auto-complete suggestions.
   * POST /api/ai/auto-complete
   */
  async autoComplete(title: string): Promise<unknown> {
    return this.request("POST", "/api/ai/auto-complete", { title });
  }

  /**
   * Get suggested time slots for a task.
   * POST /api/ai/suggest-timeslot
   */
  async suggestTimeslot(
    workspaceId: string,
    taskId: string,
    date?: string,
  ): Promise<unknown> {
    const body: Record<string, string> = { workspaceId, taskId };
    if (date) body.date = date;
    return this.request("POST", "/api/ai/suggest-timeslot", body);
  }

  // ── Schedule ───────────────────────────────────────────────────────

  /**
   * Get workspace schedule projection.
   * GET /api/schedule/projection?workspaceId=xxx
   */
  async getScheduleProjection(workspaceId: string): Promise<unknown> {
    return this.request(
      "GET",
      `/api/schedule/projection?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
  }
}
