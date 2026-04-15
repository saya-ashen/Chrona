import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decomposeTaskSmart } from "../task-decomposer";
import type { TaskDecompositionInput } from "../types";

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

function makeInput(
  overrides: Partial<TaskDecompositionInput> = {},
): TaskDecompositionInput {
  return {
    taskId: "task-1",
    title: "Default Task",
    description: undefined,
    priority: "Medium",
    dueAt: null,
    estimatedMinutes: undefined,
    ...overrides,
  };
}

// ---------- Tests ----------

describe("decomposeTaskSmart", () => {
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
    it("uses rule-based decomposition when env vars not set", async () => {
      const input = makeInput({
        title: "Write documentation and create tests",
      });

      const result = await decomposeTaskSmart(input);

      // Rule-based should split on "and"
      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Write documentation");
      expect(result.subtasks[1].title).toBe("Create tests");
    });

    it("uses rule-based decomposition for description lists when LLM unavailable", async () => {
      const input = makeInput({
        title: "Setup project",
        description: "1. Init repo\n2. Configure CI\n3. Deploy",
      });

      const result = await decomposeTaskSmart(input);

      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Init repo");
      expect(result.subtasks[1].title).toBe("Configure CI");
      expect(result.subtasks[2].title).toBe("Deploy");
    });

    it("returns empty subtasks for un-decomposable task when LLM unavailable", async () => {
      const input = makeInput({
        title: "Simple task",
      });

      const result = await decomposeTaskSmart(input);

      expect(result.subtasks.length).toBe(0);
      expect(result.feasibilityScore).toBe(0);
    });
  });

  // ─── Uses LLM when available ──────────────────────────

  describe("uses LLM when available", () => {
    beforeEach(() => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      process.env.AI_PROVIDER_MODEL = "gpt-4o-mini";
    });

    it("returns LLM-generated decomposition when LLM succeeds", async () => {
      const llmResult = {
        subtasks: [
          {
            title: "Research best practices",
            description: "Look up patterns",
            estimatedMinutes: 30,
            priority: "Medium",
            order: 1,
            dependsOnPrevious: false,
          },
          {
            title: "Implement solution",
            description: "Write the code",
            estimatedMinutes: 60,
            priority: "Medium",
            order: 2,
            dependsOnPrevious: true,
          },
        ],
        totalEstimatedMinutes: 90,
        feasibilityScore: 85,
        warnings: [],
      };

      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(makeLLMApiResponse(JSON.stringify(llmResult))),
      );

      const input = makeInput({
        title: "Build a new feature",
        description: "Create the user profile page",
      });

      const result = await decomposeTaskSmart(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Research best practices");
      expect(result.subtasks[1].title).toBe("Implement solution");
      expect(result.totalEstimatedMinutes).toBe(90);
      expect(result.feasibilityScore).toBe(85);
    });

    it("sends correct prompt to LLM including task details", async () => {
      const llmResult = {
        subtasks: [
          {
            title: "Step 1",
            estimatedMinutes: 30,
            priority: "High",
            order: 1,
            dependsOnPrevious: false,
          },
        ],
        totalEstimatedMinutes: 30,
        feasibilityScore: 70,
        warnings: [],
      };

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(
          mockFetchResponse(makeLLMApiResponse(JSON.stringify(llmResult))),
        );

      const input = makeInput({
        title: "Deploy application",
        description: "Deploy to production server",
        priority: "High",
        estimatedMinutes: 45,
      });

      await decomposeTaskSmart(input);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);

      // Should have system and user messages
      expect(body.messages.length).toBe(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");

      // User message should contain task details
      const userContent = body.messages[1].content;
      expect(userContent).toContain("Deploy application");
      expect(userContent).toContain("Deploy to production server");
      expect(userContent).toContain("High");
      expect(userContent).toContain("45");

      // Should use jsonMode (response_format)
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("falls back to rule-based when LLM returns empty subtasks", async () => {
      const llmResult = {
        subtasks: [],
        totalEstimatedMinutes: 0,
        feasibilityScore: 0,
        warnings: [],
      };

      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(makeLLMApiResponse(JSON.stringify(llmResult))),
      );

      const input = makeInput({
        title: "Write docs and create tests",
      });

      const result = await decomposeTaskSmart(input);

      // Should fall back to rule-based (conjunction split)
      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Write docs");
      expect(result.subtasks[1].title).toBe("Create tests");
    });

    it("falls back to rule-based when LLM returns null", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      // If LLM returns empty content, JSON parse fails -> fallback
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse({
          choices: [{ message: { content: "" } }],
          model: "gpt-4o-mini",
        }),
      );

      const input = makeInput({
        title: "Plan and execute migration",
      });

      // Empty string from LLM -> JSON parse fails -> exception -> fallback
      const result = await decomposeTaskSmart(input);

      // Falls back to rule-based (verb pattern)
      expect(result.subtasks.length).toBe(2);
    });
  });

  // ─── Falls back when LLM throws ──────────────────────

  describe("falls back to rule-based when LLM throws", () => {
    beforeEach(() => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
    });

    it("falls back on fetch network error", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(
        new Error("Network error"),
      );

      // Suppress console.warn from the fallback code
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const input = makeInput({
        title: "Design and implement API",
      });

      const result = await decomposeTaskSmart(input);

      // Should fall back to verb-pattern rule-based decomposition
      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Design API");
      expect(result.subtasks[1].title).toBe("Implement API");
    });

    it("falls back on HTTP 500 error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const input = makeInput({
        title: "Build and test the module",
      });

      const result = await decomposeTaskSmart(input);

      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Build the module");
      expect(result.subtasks[1].title).toBe("Test the module");
    });

    it("falls back on malformed JSON from LLM", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(
          makeLLMApiResponse("This is definitely not JSON {{{"),
        ),
      );

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const input = makeInput({
        title: "Write and review code",
      });

      const result = await decomposeTaskSmart(input);

      // Falls back to verb-pattern rule-based
      expect(result.subtasks.length).toBe(2);
      expect(result.subtasks[0].title).toBe("Write code");
      expect(result.subtasks[1].title).toBe("Review code");
    });

    it("falls back on HTTP 429 rate limit error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Rate limited", { status: 429 }),
      );

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const input = makeInput({
        title: "Fix bugs",
        description: "- Fix login\n- Fix search\n- Fix layout",
      });

      const result = await decomposeTaskSmart(input);

      // Falls back to description-based rule decomposition
      expect(result.subtasks.length).toBe(3);
      expect(result.subtasks[0].title).toBe("Fix login");
    });
  });
});
