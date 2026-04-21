import { describe, expect, it } from "vitest";

import {
  extractStructuredResultFromToolCalls,
  validateStructuredSubmission,
} from "./structured-result";

describe("structured result validation", () => {
  it("validates success payload", () => {
    const validated = validateStructuredSubmission({
      schemaName: "demo",
      schemaVersion: "1.0.0",
      status: "success",
      confidence: 0.88,
      result: { answer: 42 },
      missingFields: [],
      followUpQuestions: [],
      notes: ["done"],
    });

    expect(validated.ok).toBe(true);
    expect(validated.parsed?.result).toEqual({ answer: 42 });
  });

  it("validates needs_clarification payload", () => {
    const validated = validateStructuredSubmission({
      schemaName: "demo",
      schemaVersion: "1.0.0",
      status: "needs_clarification",
      confidence: 0.25,
      result: { partial: true },
      missingFields: ["taskId"],
      followUpQuestions: ["Please provide taskId"],
      notes: [],
    });

    expect(validated.ok).toBe(true);
    expect(validated.parsed?.status).toBe("needs_clarification");
  });

  it("reports invalid payload fields", () => {
    const validated = validateStructuredSubmission({
      schemaName: "",
      schemaVersion: "",
      status: "bad-status",
      confidence: 2,
      result: null,
      missingFields: "oops",
      followUpQuestions: [],
      notes: [],
    });

    expect(validated.ok).toBe(false);
    expect(validated.issues.length).toBeGreaterThan(0);
  });

  it("extracts submit_structured_result tool call", () => {
    const extracted = extractStructuredResultFromToolCalls([
      {
        tool: "submit_structured_result",
        input: {
          schemaName: "demo",
          schemaVersion: "1.0.0",
          status: "success",
          confidence: 1,
          result: { answer: 42 },
          missingFields: [],
          followUpQuestions: [],
          notes: [],
        },
      },
    ]);

    expect(extracted.toolCall?.tool).toBe("submit_structured_result");
    expect(extracted.validation?.ok).toBe(true);
  });
});
