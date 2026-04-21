// src/index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
var StructuredResultSchema = {
  type: "object",
  additionalProperties: false,
  description: "Structured result envelope consumed by Chrona's OpenClaw bridge/client stack.",
  required: [
    "schemaName",
    "schemaVersion",
    "status",
    "confidence",
    "result",
    "missingFields",
    "followUpQuestions",
    "notes"
  ],
  properties: {
    schemaName: {
      type: "string",
      minLength: 1,
      description: "Stable schema identifier for the structured result payload."
    },
    schemaVersion: {
      type: "string",
      minLength: 1,
      description: "Semantic version for the structured result schema."
    },
    status: {
      type: "string",
      enum: ["success", "needs_clarification", "error"],
      description: "Outcome status for the task."
    },
    confidence: {
      anyOf: [
        { type: "number", minimum: 0, maximum: 1 },
        { type: "null" }
      ],
      description: "Model confidence from 0 to 1, or null if unknown."
    },
    result: {
      description: "Structured result payload for the business task."
    },
    missingFields: {
      type: "array",
      items: { type: "string" },
      description: "Fields or facts still required from the user or system.",
      default: []
    },
    followUpQuestions: {
      type: "array",
      items: { type: "string" },
      description: "Concrete follow-up questions when status=needs_clarification.",
      default: []
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Extra notes, caveats, or reasoning summary.",
      default: []
    }
  }
};
function normalizeStringArray(value) {
  if (!Array.isArray(value))
    return [];
  return value.filter((item) => typeof item === "string");
}
var src_default = definePluginEntry({
  id: "chrona-structured-result",
  name: "Chrona Structured Result",
  description: "Provides submit_structured_result for reliable machine-readable OpenClaw outputs.",
  reload: { restartPrefixes: ["gateway", "plugins"] },
  register(api) {
    api.registerTool({
      name: "submit_structured_result",
      label: "Submit Structured Result",
      description: "Submit the final structured machine-readable result for a Chrona task. Must be called for structured tasks instead of relying on assistant text.",
      parameters: StructuredResultSchema,
      async execute(_toolCallId, params) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(params, null, 2)
            }
          ],
          details: {
            schemaName: params.schemaName,
            schemaVersion: params.schemaVersion,
            status: params.status,
            confidence: params.confidence,
            result: params.result ?? null,
            missingFields: normalizeStringArray(params.missingFields),
            followUpQuestions: normalizeStringArray(params.followUpQuestions),
            notes: normalizeStringArray(params.notes)
          }
        };
      }
    }, { name: "submit_structured_result" });
    api.logger.info("Chrona structured-result plugin loaded");
  }
});
export {
  src_default as default
};
