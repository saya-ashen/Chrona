import { validateTaskConfigAgainstSpec } from "@chrona/runtime-core";
import type { RuntimeInput, RuntimeTaskConfigSpec } from "@chrona/runtime-core";

export const RESEARCH_RUNTIME_ADAPTER_KEY = "research";
export const RESEARCH_RUNTIME_INPUT_VERSION = "research-v1";

const RESEARCH_TASK_CONFIG_SPEC: RuntimeTaskConfigSpec = {
  adapterKey: RESEARCH_RUNTIME_ADAPTER_KEY,
  version: RESEARCH_RUNTIME_INPUT_VERSION,
  fields: [
    {
      key: "prompt",
      path: "prompt",
      kind: "textarea",
      label: "Research brief",
      description: "Describe the question, scope, and expected output",
      required: true,
      constraints: {
        maxLength: 20000,
      },
    },
    {
      key: "depth",
      path: "depth",
      kind: "select",
      label: "Research depth",
      description: "Choose how deeply the agent should investigate",
      defaultValue: "standard",
      options: [
        { value: "quick", label: "Quick" },
        { value: "standard", label: "Standard" },
        { value: "deep", label: "Deep" },
      ],
    },
    {
      key: "citationStyle",
      path: "citationStyle",
      kind: "select",
      label: "Citation style",
      description: "Choose how references should be returned",
      advanced: true,
      defaultValue: "bullet-links",
      options: [
        { value: "bullet-links", label: "Bullet links" },
        { value: "footnotes", label: "Footnotes" },
      ],
    },
    {
      key: "webSearch",
      path: "webSearch",
      kind: "boolean",
      label: "Allow web search",
      description: "Enable live web search tools during research",
      advanced: true,
      defaultValue: true,
    },
  ],
  runnability: {
    requiredPaths: ["prompt"],
  },
};

export function getResearchTaskConfigSpec() {
  return RESEARCH_TASK_CONFIG_SPEC;
}

export function validateResearchTaskConfig(input: unknown) {
  return validateTaskConfigAgainstSpec(RESEARCH_TASK_CONFIG_SPEC, input);
}

function buildResearchRunPrompt(runtimeInput: RuntimeInput) {
  const prompt = typeof runtimeInput.prompt === "string" ? runtimeInput.prompt.trim() : "";
  const depth =
    typeof runtimeInput.depth === "string" && runtimeInput.depth.trim()
      ? runtimeInput.depth.trim()
      : "standard";
  const citationStyle =
    typeof runtimeInput.citationStyle === "string" && runtimeInput.citationStyle.trim()
      ? runtimeInput.citationStyle.trim()
      : "bullet-links";
  const webSearch = typeof runtimeInput.webSearch === "boolean" ? runtimeInput.webSearch : true;

  return [
    prompt,
    "",
    "Research execution settings:",
    `- Depth: ${depth}`,
    `- Citation style: ${citationStyle}`,
    `- Web search: ${webSearch ? "enabled" : "disabled"}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

