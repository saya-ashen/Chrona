import { describe, expect, it, vi } from "vitest";
import {
  buildResearchRunPrompt,
  createResearchRuntimeAdapter,
  getResearchTaskConfigSpec,
  validateResearchTaskConfig,
} from "@/modules/research-execution/adapter";
import type { RuntimeExecutionAdapter } from "@/modules/task-execution/types";

describe("research task config", () => {
  it("returns a spec with a different field set and required rule", () => {
    expect(getResearchTaskConfigSpec()).toMatchObject({
      adapterKey: "research",
      version: "research-v1",
      runnability: {
        requiredPaths: ["prompt"],
      },
    });
    expect(getResearchTaskConfigSpec().fields.map((field) => field.path)).toEqual([
      "prompt",
      "depth",
      "citationStyle",
      "webSearch",
    ]);
  });

  it("applies defaults without requiring a model", () => {
    expect(
      validateResearchTaskConfig({
        prompt: "  Investigate why schedule blocks drift  ",
      }),
    ).toEqual({
      prompt: "Investigate why schedule blocks drift",
      depth: "standard",
      citationStyle: "bullet-links",
      webSearch: true,
    });
  });

  it("rejects invalid research-only enum values", () => {
    expect(() =>
      validateResearchTaskConfig({
        prompt: "Ship it",
        depth: "extreme",
      }),
    ).toThrow(/Research depth must be one of/);
  });

  it("builds an execution prompt that includes research-specific settings", () => {
    expect(
      buildResearchRunPrompt({
        prompt: "Investigate rollout failures",
        depth: "deep",
        citationStyle: "footnotes",
        webSearch: false,
      }),
    ).toContain("- Depth: deep");
    expect(
      buildResearchRunPrompt({
        prompt: "Investigate rollout failures",
        depth: "deep",
        citationStyle: "footnotes",
        webSearch: false,
      }),
    ).toContain("- Citation style: footnotes");
    expect(
      buildResearchRunPrompt({
        prompt: "Investigate rollout failures",
        depth: "deep",
        citationStyle: "footnotes",
        webSearch: false,
      }),
    ).toContain("- Web search: disabled");
  });

  it("passes research settings through to execution via the composed prompt", async () => {
    const createRun = vi.fn().mockResolvedValue({ runStarted: true });
    const baseAdapter: RuntimeExecutionAdapter = {
      createRun,
      sendOperatorMessage: async () => ({ accepted: true, runStarted: false }),
      getRunSnapshot: async () => null,
      readHistory: async () => [],
      listApprovals: async () => [],
      waitForApprovalDecision: async () => null,
      resumeRun: async () => null,
    };
    const adapter = await createResearchRuntimeAdapter(baseAdapter);

    await adapter.createRun({
      prompt: "Investigate rollout failures",
      runtimeInput: {
        prompt: "Investigate rollout failures",
        depth: "deep",
        citationStyle: "footnotes",
        webSearch: false,
      },
    });

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("- Depth: deep"),
      }),
    );
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("- Citation style: footnotes"),
      }),
    );
  });
});
