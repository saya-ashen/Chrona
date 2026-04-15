import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { suggestAutomationSmart, suggestAutomation } from "../automation-suggester";
import type { TaskAutomationInput } from "../types";

// ---------- Helpers ----------

function mockFetchResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeLLMApiResponse(content: string, model = "gpt-4o-mini") {
  return {
    choices: [{ message: { content } }],
    model,
    usage: {
      prompt_tokens: 10,
      completion_tokens: 50,
      total_tokens: 60,
    },
  };
}

function makeTask(
  overrides: Partial<TaskAutomationInput> = {},
): TaskAutomationInput {
  return {
    taskId: "task-1",
    title: "Default Task",
    description: "A default task description",
    priority: "Medium",
    dueAt: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    isRunnable: false,
    runnabilityState: "idle",
    ownerType: "user",
    tags: [],
    ...overrides,
  };
}

// ---------- Tests ----------

describe("suggestAutomationSmart", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_PROVIDER_API_KEY;
    delete process.env.AI_PROVIDER_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ─── Fallback to rule-based when LLM unavailable ──────

  describe("fallback to rule-based when LLM unavailable", () => {
    it("uses rule-based suggestion when env vars not set", async () => {
      const task = makeTask({
        title: "Daily standup",
        priority: "Medium",
      });

      const result = await suggestAutomationSmart(task);
      const ruleResult = suggestAutomation(task);

      // Should produce identical results to rule-based
      expect(result.executionMode).toBe(ruleResult.executionMode);
      expect(result.reminderStrategy).toEqual(ruleResult.reminderStrategy);
      expect(result.confidence).toBe(ruleResult.confidence);
    });

    it("detects recurring task via rule-based when LLM unavailable", async () => {
      const task = makeTask({
        title: "Weekly team sync",
        priority: "Medium",
      });

      const result = await suggestAutomationSmart(task);

      expect(result.executionMode).toBe("recurring");
      expect(result.reminderStrategy.frequency).toBe("recurring");
      expect(result.reminderStrategy.channels).toContain("calendar");
    });

    it("suggests immediate mode for high priority runnable tasks via rules", async () => {
      const task = makeTask({
        title: "Deploy hotfix",
        priority: "Urgent",
        isRunnable: true,
      });

      const result = await suggestAutomationSmart(task);

      expect(result.executionMode).toBe("immediate");
    });

    it("suggests scheduled mode for tasks with scheduled time via rules", async () => {
      const task = makeTask({
        title: "Code review",
        priority: "Medium",
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
        scheduledEndAt: new Date("2026-04-16T11:00:00Z"),
      });

      const result = await suggestAutomationSmart(task);

      expect(result.executionMode).toBe("scheduled");
    });

    it("suggests manual mode for basic tasks via rules", async () => {
      const task = makeTask({
        title: "Read article",
        priority: "Low",
      });

      const result = await suggestAutomationSmart(task);

      expect(result.executionMode).toBe("manual");
    });
  });

  // ─── Uses LLM when available ──────────────────────────

  describe("uses LLM when available", () => {
    beforeEach(() => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      process.env.AI_PROVIDER_MODEL = "gpt-4o-mini";
    });

    it("returns LLM-generated suggestion when LLM succeeds", async () => {
      const llmResult = {
        executionMode: "scheduled" as const,
        reminderStrategy: {
          advanceMinutes: 20,
          frequency: "once" as const,
          channels: ["push", "email"],
        },
        preparationSteps: ["Review requirements", "Prepare environment"],
        contextSources: [
          { type: "docs", description: "Project documentation" },
        ],
        confidence: "high" as const,
        reasoning: "Task has clear schedule and requirements",
      };

      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(makeLLMApiResponse(JSON.stringify(llmResult))),
      );

      const task = makeTask({
        title: "Deploy new version",
        description: "Deploy v2.0 to production",
        priority: "High",
        scheduledStartAt: new Date("2026-04-16T14:00:00Z"),
      });

      const result = await suggestAutomationSmart(task);

      expect(result.executionMode).toBe("scheduled");
      expect(result.confidence).toBe("high");
      expect(result.preparationSteps).toContain("Review requirements");
    });

    it("sends correct prompt with task details to LLM", async () => {
      const llmResult = {
        executionMode: "manual",
        reminderStrategy: {
          advanceMinutes: 30,
          frequency: "once",
          channels: ["push"],
        },
        preparationSteps: ["Read docs"],
        contextSources: [],
        confidence: "medium",
      };

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(
          mockFetchResponse(makeLLMApiResponse(JSON.stringify(llmResult))),
        );

      const task = makeTask({
        title: "Research AI frameworks",
        description: "Evaluate TensorFlow vs PyTorch",
        priority: "Medium",
        tags: ["research", "ai"],
      });

      await suggestAutomationSmart(task);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);

      // Should have system and user messages
      expect(body.messages.length).toBe(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");

      // User message should contain task details
      const userContent = body.messages[1].content;
      expect(userContent).toContain("Research AI frameworks");
      expect(userContent).toContain("Evaluate TensorFlow vs PyTorch");
      expect(userContent).toContain("Medium");
      expect(userContent).toContain("research");
    });
  });

  // ─── Falls back when LLM throws ──────────────────────

  describe("falls back to rule-based when LLM throws", () => {
    beforeEach(() => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
    });

    it("falls back on network error", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(
        new Error("Network error"),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const task = makeTask({
        title: "Weekly standup meeting",
        priority: "Medium",
      });

      const result = await suggestAutomationSmart(task);
      const ruleResult = suggestAutomation(task);

      // Should fall back to rule-based
      expect(result.executionMode).toBe(ruleResult.executionMode);
      expect(result.reminderStrategy).toEqual(ruleResult.reminderStrategy);
    });

    it("falls back on HTTP 500 error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const task = makeTask({
        title: "Deploy service",
        priority: "Urgent",
        isRunnable: true,
      });

      const result = await suggestAutomationSmart(task);

      // Should fall back to rule-based immediate mode
      expect(result.executionMode).toBe("immediate");
    });

    it("falls back on malformed JSON from LLM", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(
          makeLLMApiResponse("Not valid JSON response {{{"),
        ),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const task = makeTask({
        title: "Recurring daily standup",
        priority: "Medium",
      });

      const result = await suggestAutomationSmart(task);

      // Should fall back to rule-based recurring detection
      expect(result.executionMode).toBe("recurring");
    });

    it("falls back when LLM returns null content", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse({
          choices: [{ message: { content: "" } }],
          model: "gpt-4o-mini",
        }),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const task = makeTask({
        title: "Read documentation",
        priority: "Low",
      });

      const result = await suggestAutomationSmart(task);

      expect(result.executionMode).toBe("manual");
      expect(result.confidence).toBe("low");
    });
  });

  // ─── Confidence and preparation steps from rules ──────

  describe("rule-based confidence and preparation steps", () => {
    it("returns high confidence when task has many details", async () => {
      const task = makeTask({
        title: "Deploy service",
        description: "Deploy v2 to production cluster",
        priority: "High",
        isRunnable: true,
        scheduledStartAt: new Date("2026-04-16T10:00:00Z"),
        scheduledEndAt: new Date("2026-04-16T11:00:00Z"),
        dueAt: new Date("2026-04-17T00:00:00Z"),
        tags: ["deployment", "production"],
      });

      const result = await suggestAutomationSmart(task);

      expect(result.confidence).toBe("high");
    });

    it("returns low confidence when task has minimal details", async () => {
      const task = makeTask({
        title: "Something",
        description: "",
        priority: "Low",
        isRunnable: false,
        tags: [],
      });

      const result = await suggestAutomationSmart(task);

      expect(result.confidence).toBe("low");
    });

    it("includes preparation steps for runnable tasks", async () => {
      const task = makeTask({
        title: "Run tests",
        isRunnable: true,
        runnabilityState: "ready",
      });

      const result = await suggestAutomationSmart(task);

      expect(result.preparationSteps).toContain("Check runtime configuration");
      expect(result.preparationSteps).toContain("Ensure dependencies are met");
      expect(
        result.preparationSteps.some((s) => s.includes("runnability state")),
      ).toBe(true);
    });

    it("includes team coordination step for team-owned tasks", async () => {
      const task = makeTask({
        title: "Code review",
        ownerType: "team",
      });

      const result = await suggestAutomationSmart(task);

      expect(
        result.preparationSteps.some((s) =>
          s.includes("Coordinate with team"),
        ),
      ).toBe(true);
    });
  });
});
