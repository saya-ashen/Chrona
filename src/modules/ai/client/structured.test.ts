import { describe, expect, it } from "vitest";

import {
  SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
  parseDirectStructuredEnvelope,
  requireStructuredResult,
} from "./structured";

describe("structured result helpers", () => {
  it("accepts a valid success envelope", () => {
    const result = parseDirectStructuredEnvelope<{ value: number }>({
      schemaName: "demo",
      schemaVersion: "1.0.0",
      status: "success",
      confidence: 0.9,
      result: { value: 42 },
      missingFields: [],
      followUpQuestions: [],
      notes: ["ok"],
    }, "openclaw");

    expect(result.ok).toBe(true);
    expect(result.parsed).toEqual({ value: 42 });
    expect(result.structured?.status).toBe("success");
  });

  it("accepts needs_clarification envelope with missing fields", () => {
    const result = parseDirectStructuredEnvelope({
      schemaName: "demo",
      schemaVersion: "1.0.0",
      status: "needs_clarification",
      confidence: 0.4,
      result: { partial: true },
      missingFields: ["taskId"],
      followUpQuestions: ["请提供 taskId"],
      notes: [],
    }, "openclaw");

    expect(result.ok).toBe(true);
    expect(result.status).toBe("needs_clarification");
    expect(result.structured?.missingFields).toEqual(["taskId"]);
  });

  it("rejects invalid envelope shape", () => {
    const result = parseDirectStructuredEnvelope({
      schemaName: "",
      schemaVersion: "",
      status: "bad-status",
      confidence: 2,
      result: null,
      missingFields: "oops",
      followUpQuestions: [],
      notes: [],
    }, "openclaw");

    expect(result.ok).toBe(false);
    expect(result.validationIssues?.length).toBeGreaterThan(0);
  });

  it("throws when bridge structured result falls back without tool call", () => {
    expect(() =>
      requireStructuredResult(
        {
          mode: "structured",
          text: "raw text only",
          structured: {
            ok: false,
            parsed: null,
            structured: null,
            rawOutput: "raw text only",
            error: `Structured result tool '${SUBMIT_STRUCTURED_RESULT_TOOL_NAME}' missing`,
            reliability: "fallback_text",
          },
          bridge: {
            sessionId: "sess-1",
            output: "raw text only",
            toolCalls: [],
            usage: null,
            error: null,
            durationMs: 12,
            structured: null,
          },
        },
        "openclaw",
      ),
    ).toThrow(/Structured result tool/);
  });
});
