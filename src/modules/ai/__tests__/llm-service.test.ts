import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isLLMAvailable,
  chatCompletion,
  chatCompletionJSON,
  taskDecompositionSystemPrompt,
  automationSuggestionSystemPrompt,
  conflictResolutionSystemPrompt,
  timeslotSuggestionSystemPrompt,
  taskAutoCompleteSystemPrompt,
  taskPlanSystemPrompt,
} from "../llm-service";
import type { ChatCompletionOptions } from "../llm-service";

// ---------- Helpers ----------

function mockFetchResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeChatApiResponse(content: string, model = "gpt-4o-mini") {
  return {
    choices: [{ message: { content } }],
    model,
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

// ---------- Tests ----------

describe("llm-service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_PROVIDER_API_KEY;
    delete process.env.AI_PROVIDER_MODEL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ─── isLLMAvailable ─────────────────────────────────────

  describe("isLLMAvailable", () => {
    it("returns false when no env vars are set", () => {
      expect(isLLMAvailable()).toBe(false);
    });

    it("returns false when only AI_PROVIDER_BASE_URL is set", () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      expect(isLLMAvailable()).toBe(false);
    });

    it("returns false when only AI_PROVIDER_API_KEY is set", () => {
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      expect(isLLMAvailable()).toBe(false);
    });

    it("returns true when both AI_PROVIDER_BASE_URL and AI_PROVIDER_API_KEY are set", () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      expect(isLLMAvailable()).toBe(true);
    });

    it("returns true when all three env vars are set", () => {
      process.env.AI_PROVIDER_BASE_URL = "https://openrouter.ai/api/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      process.env.AI_PROVIDER_MODEL = "claude-sonnet-4-20250514";
      expect(isLLMAvailable()).toBe(true);
    });

    it("returns false when base URL is empty string", () => {
      process.env.AI_PROVIDER_BASE_URL = "";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      expect(isLLMAvailable()).toBe(false);
    });

    it("returns false when API key is empty string", () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "";
      expect(isLLMAvailable()).toBe(false);
    });
  });

  // ─── chatCompletion ─────────────────────────────────────

  describe("chatCompletion", () => {
    it("returns null when not configured", async () => {
      const result = await chatCompletion({
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(result).toBeNull();
    });

    it("makes correct fetch call with proper headers and body", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key-123";
      process.env.AI_PROVIDER_MODEL = "gpt-4o-mini";

      const apiResponse = makeChatApiResponse("Hello back!");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      const options: ChatCompletionOptions = {
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello" },
        ],
        temperature: 0.5,
      };

      await chatCompletion(options);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];

      // Check URL
      expect(url).toBe("https://api.openai.com/v1/chat/completions");

      // Check headers
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
      expect(
        (init?.headers as Record<string, string>)["Authorization"],
      ).toBe("Bearer sk-test-key-123");

      // Check body
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.messages).toEqual(options.messages);
      expect(body.temperature).toBe(0.5);
    });

    it("uses default model when AI_PROVIDER_MODEL is not set", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      // AI_PROVIDER_MODEL not set

      const apiResponse = makeChatApiResponse("response");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
    });

    it("uses custom model from options over default", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      process.env.AI_PROVIDER_MODEL = "default-model";

      const apiResponse = makeChatApiResponse("response");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
        model: "custom-model",
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.model).toBe("custom-model");
    });

    it("uses default temperature of 0.7 when not specified", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse("response");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.temperature).toBe(0.7);
    });

    it("includes max_tokens when maxTokens is provided", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse("response");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
        maxTokens: 1000,
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.max_tokens).toBe(1000);
    });

    it("does not include max_tokens when maxTokens is not provided", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse("response");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.max_tokens).toBeUndefined();
    });

    it("includes response_format when jsonMode is true", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse('{"key":"value"}');
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
        jsonMode: true,
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("does not include response_format when jsonMode is false/undefined", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse("plain text");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.response_format).toBeUndefined();
    });

    it("returns parsed ChatCompletionResult on success", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse("Hello!", "gpt-4o");
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(apiResponse),
      );

      const result = await chatCompletion({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result).not.toBeNull();
      expect(result!.content).toBe("Hello!");
      expect(result!.model).toBe("gpt-4o");
      expect(result!.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
    });

    it("returns empty string content when choices are missing", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse({ model: "gpt-4o-mini" }),
      );

      const result = await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result).not.toBeNull();
      expect(result!.content).toBe("");
    });

    it("returns undefined usage when not present in response", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse({
          choices: [{ message: { content: "hi" } }],
          model: "gpt-4o-mini",
        }),
      );

      const result = await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result!.usage).toBeUndefined();
    });

    it("throws on non-200 response", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Rate limit exceeded", {
          status: 429,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      await expect(
        chatCompletion({
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow("LLM API error (429)");
    });

    it("throws on 500 response with error details", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      await expect(
        chatCompletion({
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow("LLM API error (500)");
    });

    it("throws on 401 unauthorized", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "bad-key";

      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response('{"error":"invalid_api_key"}', {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(
        chatCompletion({
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow("LLM API error (401)");
    });

    it("strips trailing slashes from base URL", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1///";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse("ok");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      const url = fetchSpy.mock.calls[0][0];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("passes signal option through to fetch", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse("ok");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      const controller = new AbortController();
      await chatCompletion({
        messages: [{ role: "user", content: "test" }],
        signal: controller.signal,
      });

      expect(fetchSpy.mock.calls[0][1]?.signal).toBe(controller.signal);
    });

    it("falls back model name if API response has no model field", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";
      process.env.AI_PROVIDER_MODEL = "my-model";

      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse({
          choices: [{ message: { content: "hi" } }],
          // no model field
        }),
      );

      const result = await chatCompletion({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result!.model).toBe("my-model");
    });
  });

  // ─── chatCompletionJSON ─────────────────────────────────

  describe("chatCompletionJSON", () => {
    it("returns null when LLM is not configured", async () => {
      const result = await chatCompletionJSON<{ foo: string }>({
        messages: [{ role: "user", content: "test" }],
      });
      expect(result).toBeNull();
    });

    it("parses JSON from response content", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const jsonPayload = { subtasks: ["a", "b"], score: 95 };
      const apiResponse = makeChatApiResponse(JSON.stringify(jsonPayload));
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(apiResponse),
      );

      const result = await chatCompletionJSON<typeof jsonPayload>({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result).toEqual(jsonPayload);
    });

    it("extracts JSON from markdown code blocks", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const jsonPayload = { result: "extracted" };
      const wrappedContent = `Here is the result:\n\`\`\`json\n${JSON.stringify(jsonPayload)}\n\`\`\``;
      const apiResponse = makeChatApiResponse(wrappedContent);
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(apiResponse),
      );

      const result = await chatCompletionJSON<typeof jsonPayload>({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result).toEqual(jsonPayload);
    });

    it("extracts JSON from code blocks without json language tag", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const jsonPayload = { data: [1, 2, 3] };
      const wrappedContent = `\`\`\`\n${JSON.stringify(jsonPayload)}\n\`\`\``;
      const apiResponse = makeChatApiResponse(wrappedContent);
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(apiResponse),
      );

      const result = await chatCompletionJSON<typeof jsonPayload>({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result).toEqual(jsonPayload);
    });

    it("throws when content is not valid JSON and has no code block", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse(
        "This is plain text, not JSON at all.",
      );
      vi.spyOn(global, "fetch").mockResolvedValue(
        mockFetchResponse(apiResponse),
      );

      await expect(
        chatCompletionJSON({
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow("Failed to parse LLM JSON response");
    });

    it("always sets jsonMode to true in the underlying call", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      const apiResponse = makeChatApiResponse('{"ok":true}');
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(mockFetchResponse(apiResponse));

      await chatCompletionJSON({
        messages: [{ role: "user", content: "test" }],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("propagates HTTP errors from underlying chatCompletion", async () => {
      process.env.AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
      process.env.AI_PROVIDER_API_KEY = "sk-test-key";

      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Bad Request", { status: 400 }),
      );

      await expect(
        chatCompletionJSON({
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow("LLM API error (400)");
    });
  });

  // ─── Prompt templates ───────────────────────────────────

  describe("prompt templates", () => {
    it("taskDecompositionSystemPrompt returns a non-empty string with JSON instruction", () => {
      const prompt = taskDecompositionSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("subtasks");
      expect(prompt).toContain("JSON");
    });

    it("automationSuggestionSystemPrompt returns a non-empty string with JSON instruction", () => {
      const prompt = automationSuggestionSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("executionMode");
      expect(prompt).toContain("JSON");
    });

    it("conflictResolutionSystemPrompt returns a non-empty string with JSON instruction", () => {
      const prompt = conflictResolutionSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("suggestions");
      expect(prompt).toContain("JSON");
    });

    it("timeslotSuggestionSystemPrompt returns a non-empty string", () => {
      const prompt = timeslotSuggestionSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("suggestions");
    });

    it("taskAutoCompleteSystemPrompt returns a non-empty string", () => {
      const prompt = taskAutoCompleteSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("suggestions");
    });

    it("taskPlanSystemPrompt returns a non-empty string with steps", () => {
      const prompt = taskPlanSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("steps");
    });
  });
});
