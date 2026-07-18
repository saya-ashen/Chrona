import { describe, expect, it } from "bun:test";
import { checkpointPayloadFields } from "./execution-actions";

describe("checkpointPayloadFields", () => {
  it("preserves supported structured checkpoint values", () => {
    expect(checkpointPayloadFields({
      channels: ["official", "euraxess"],
      regions: ["eu", "uk"],
      research_interests: "AI, LLM, Agent",
      exclude_self_funded: true,
      ignored_number: 3,
      ignored_object: { unsafe: true },
    })).toEqual({
      channels: ["official", "euraxess"],
      regions: ["eu", "uk"],
      research_interests: "AI, LLM, Agent",
      exclude_self_funded: true,
    });
  });

  it("reads the nested inputFields compatibility shape", () => {
    expect(checkpointPayloadFields({
      inputFields: {
        notes: "Use official sources",
        include_rolling: false,
        locations: ["de", "nl"],
      },
      message: "not a field",
    })).toEqual({
      notes: "Use official sources",
      include_rolling: false,
      locations: ["de", "nl"],
    });
  });
});
