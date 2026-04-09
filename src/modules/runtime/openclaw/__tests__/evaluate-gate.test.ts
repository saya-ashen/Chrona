import { describe, expect, it } from "vitest";
import { evaluateOpenClawGate } from "@/modules/runtime/openclaw/evaluate-gate";

describe("evaluateOpenClawGate", () => {
  it("fails when any mandatory check is missing", () => {
    const report = evaluateOpenClawGate([
      { name: "create_run", passed: true, evidence: "run_123" },
      { name: "query_status", passed: true, evidence: "Running" },
      { name: "read_outputs", passed: true, evidence: "1 output item" },
      { name: "resume_after_wait", passed: false, evidence: "resume endpoint missing" },
    ]);

    expect(report.overall).toBe("fail");
  });

  it("passes only when all four checks pass", () => {
    const report = evaluateOpenClawGate([
      { name: "create_run", passed: true, evidence: "run_123" },
      { name: "query_status", passed: true, evidence: "Running" },
      { name: "read_outputs", passed: true, evidence: "tool + message payload visible" },
      { name: "resume_after_wait", passed: true, evidence: "resume accepted" },
    ]);

    expect(report.overall).toBe("pass");
  });
});
