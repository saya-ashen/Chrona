import { describe, expect, it } from "vitest";
import {
  getOpenClawTaskConfigSpec,
  validateOpenClawTaskConfig,
} from "@/modules/openclaw/adapter";

describe("openclaw task config", () => {
  it("returns a spec with backend-defined fields and runnability rules", () => {
    expect(getOpenClawTaskConfigSpec()).toMatchObject({
      adapterKey: "openclaw",
      version: "openclaw-legacy-v1",
      runnability: {
        requiredPaths: ["model", "prompt"],
      },
    });
    expect(getOpenClawTaskConfigSpec().fields.map((field) => field.path)).toEqual([
      "model",
      "prompt",
      "temperature",
      "approvalPolicy",
      "toolMode",
      "sessionStrategy",
    ]);
  });

  it("normalizes supported values and applies adapter defaults", () => {
    expect(
      validateOpenClawTaskConfig({
        model: "  gpt-5.4  ",
        prompt: "  Investigate the failing run  ",
      }),
    ).toEqual({
      model: "gpt-5.4",
      prompt: "Investigate the failing run",
      temperature: 0.2,
      approvalPolicy: "never",
      toolMode: "workspace-write",
      sessionStrategy: "per_subtask",
    });
  });

  it("accepts shared-session execution strategy", () => {
    expect(
      validateOpenClawTaskConfig({
        model: "gpt-5.4",
        prompt: "Investigate the failing run",
        sessionStrategy: "shared",
      }),
    ).toMatchObject({
      sessionStrategy: "shared",
    });
  });

  it("keeps arbitrary legacy model strings for compatibility", () => {
    expect(
      validateOpenClawTaskConfig({
        model: "gpt-5.4-mini",
        prompt: "Investigate the failing run",
      }),
    ).toMatchObject({
      model: "gpt-5.4-mini",
    });
  });

  it("rejects invalid adapter-specific values", () => {
    expect(() =>
      validateOpenClawTaskConfig({
        model: "gpt-5.4",
        prompt: "Ship it",
        approvalPolicy: "sometimes",
      }),
    ).toThrow(/Approval policy must be one of/);

    expect(() =>
      validateOpenClawTaskConfig({
        model: "gpt-5.4",
        prompt: "Ship it",
        temperature: 3,
      }),
    ).toThrow(/Temperature must be at most 2/);
  });
});
