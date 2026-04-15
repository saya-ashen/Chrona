/**
 * HTTP API client for AgentDashboard backend.
 * Uses native fetch to communicate with the Next.js API routes.
 */

export interface TaskChange {
  taskId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  priority?: string;
  dueAt?: string;
}

export interface ApiError {
  error: string;
}

export class ApiClient {
  constructor(public readonly baseUrl: string = "http://localhost:3000") {}

  private async request<T>(
    method: "GET" | "POST",
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

  /**
   * Analyze scheduling conflicts for a workspace.
   * POST /api/ai/analyze-conflicts
   */
  async analyzeConflicts(
    workspaceId: string,
    date?: string,
  ): Promise<unknown> {
    const body: Record<string, string> = { workspaceId };
    if (date) {
      body.date = date;
    }
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
   * Get suggested time slots for a task.
   * POST /api/ai/suggest-timeslot
   */
  async suggestTimeslot(
    workspaceId: string,
    taskId: string,
    date?: string,
  ): Promise<unknown> {
    const body: Record<string, string> = { workspaceId, taskId };
    if (date) {
      body.date = date;
    }
    return this.request("POST", "/api/ai/suggest-timeslot", body);
  }

  /**
   * Get workspace schedule projection.
   * GET /api/schedule/projection?workspaceId=xxx
   */
  async getWorkspace(workspaceId: string): Promise<unknown> {
    return this.request(
      "GET",
      `/api/schedule/projection?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
  }
}
