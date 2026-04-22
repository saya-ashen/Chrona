import { validateTaskConfigAgainstSpec } from "../../../../packages/runtime-core/src/index";
import type { RuntimeTaskConfigSpec } from "../../../../packages/runtime-core/src/index";

export const OPENCLAW_RUNTIME_ADAPTER_KEY = "openclaw";
export const OPENCLAW_RUNTIME_INPUT_VERSION = "openclaw-legacy-v1";

const OPENCLAW_TASK_CONFIG_SPEC: RuntimeTaskConfigSpec = {
  adapterKey: OPENCLAW_RUNTIME_ADAPTER_KEY,
  version: OPENCLAW_RUNTIME_INPUT_VERSION,
  fields: [
    {
      key: "model",
      path: "model",
      kind: "text",
      label: "Model",
      description: "Choose the model used for this run",
      required: true,
      advanced: true,
      constraints: {
        maxLength: 200,
      },
    },
    {
      key: "prompt",
      path: "prompt",
      kind: "textarea",
      label: "Prompt / instructions",
      description: "Describe the task, constraints, and expected output",
      required: true,
      advanced: true,
      constraints: {
        maxLength: 20000,
      },
    },
    {
      key: "temperature",
      path: "temperature",
      kind: "number",
      label: "Temperature",
      description: "Controls sampling randomness",
      advanced: true,
      defaultValue: 0.2,
      constraints: {
        min: 0,
        max: 2,
        step: 0.1,
      },
    },
    {
      key: "approvalPolicy",
      path: "approvalPolicy",
      kind: "select",
      label: "Approval policy",
      description: "Decide when runtime approval is required",
      advanced: true,
      defaultValue: "never",
      options: [
        { value: "never", label: "Never" },
        { value: "on-request", label: "On request" },
        { value: "always", label: "Always" },
      ],
    },
    {
      key: "toolMode",
      path: "toolMode",
      kind: "select",
      label: "Tool mode",
      description: "Choose how aggressively tools can be used",
      advanced: true,
      defaultValue: "workspace-write",
      options: [
        { value: "read-only", label: "Read only" },
        { value: "workspace-write", label: "Workspace write" },
        { value: "full-access", label: "Full access" },
      ],
    },
    {
      key: "sessionStrategy",
      path: "sessionStrategy",
      kind: "select",
      label: "Subtask session strategy",
      description: "Decide whether child tasks reuse the parent session or get one session per subtask",
      advanced: true,
      defaultValue: "per_subtask",
      options: [
        { value: "per_subtask", label: "Per subtask" },
        { value: "shared", label: "Shared with parent" },
      ],
    },
  ],
  runnability: {
    requiredPaths: ["model", "prompt"],
  },
};

export function getOpenClawTaskConfigSpec() {
  return OPENCLAW_TASK_CONFIG_SPEC;
}

export function validateOpenClawTaskConfig(input: unknown) {
  return validateTaskConfigAgainstSpec(OPENCLAW_TASK_CONFIG_SPEC, input);
}


