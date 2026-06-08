import type { CheckpointConfig, EffectivePlanNode, NodeActionForm, NodeActionFormField } from "@chrona/contracts/ai";
import type { NodeExecutor, NodeExecutorInput, NodeExecutionResult } from "./types";
import { decideNodeExecutionSession } from "../session-policy";
import { reviewCheckpointNodeCapability } from "../runtime/node-ai-capabilities";
import type { AiRuntimeInvoker } from "../ai-runtime-invoker";

function normalizeInputFieldType(type: string | undefined): NodeActionFormField["type"] {
  if (type === "choice") return "select";
  if (type === "text" || type === "textarea" || type === "select") return type;
  return "text";
}

function actionFormForCheckpoint(input: {
  config: CheckpointConfig;
  title: string;
}): NodeActionForm | undefined {
  if (input.config.checkpointType === "input" && input.config.inputFields?.length) {
    return {
      instructions: input.config.prompt || `Please provide input for: ${input.title}`,
      submitLabel: "Submit input",
      inputFields: input.config.inputFields.map((field) => ({
        name: field.name,
        label: field.label,
        type: normalizeInputFieldType(field.type),
        required: field.required,
        options: field.options,
      })),
    };
  }

  if (input.config.checkpointType === "choose" && input.config.options?.length) {
    return {
      instructions: input.config.prompt || `Choose an option for: ${input.title}`,
      submitLabel: "Submit choice",
      inputFields: [{
        name: "choice",
        label: input.title,
        type: "select",
        required: input.config.required,
        options: input.config.options,
      }],
    };
  }

  return undefined;
}

function jsonViewOutput(value: Record<string, unknown>) {
  return { root: "root", elements: { root: { type: "JsonView", props: { value } } } };
}

export class CheckpointNodeExecutor implements NodeExecutor {
  readonly nodeType = "checkpoint" as const;

  constructor(private readonly aiRuntimeInvoker: AiRuntimeInvoker) {}

  canExecute(node: EffectivePlanNode): boolean {
    return node.type === "checkpoint";
  }

  async execute(input: NodeExecutorInput): Promise<NodeExecutionResult> {
    const sessionDecision = decideNodeExecutionSession({
      node: input.node,
      plan: input.plan,
      parentTaskId: input.taskId,
    });

    const config = input.node.config as CheckpointConfig;
    const actionForm = actionFormForCheckpoint({ config, title: input.node.title });
    if (input.inputFields) {
      const action = config.checkpointType === "approve" || config.checkpointType === "confirm"
        ? "approved"
        : "completed";
      return {
        status: "done",
        summary: `Checkpoint ${action}: ${input.node.title}`,
        output: jsonViewOutput({ inputFields: input.inputFields }),
        inputFields: input.inputFields,
        evidence: { sessionId: input.mainSession.id },
      };
    }

    if ((config.checkpointType === "approve" || config.checkpointType === "confirm") && input.userInput) {
      return {
        status: "done",
        summary: `Checkpoint approved: ${input.node.title}`,
        output: jsonViewOutput({ feedback: input.userInput }),
        evidence: { sessionId: input.mainSession.id },
      };
    }

    if (input.node.status === "completed" || input.node.status === "skipped") {
      return {
        status: "done",
        summary: `Checkpoint ${input.node.id} was already completed`,
        evidence: { sessionId: input.mainSession.id },
      };
    }

    switch (sessionDecision.kind) {
      case "wait_for_approval":
        return {
          status: "waiting_for_approval",
          prompt: config.prompt || `Please approve: ${input.node.title}`,
          reason: sessionDecision.reason,
          evidence: { sessionId: input.mainSession.id },
        };
      case "wait_for_user":
        return {
          status: "waiting_for_user",
          prompt: config.prompt || `Please provide input for: ${input.node.title}`,
          reason: sessionDecision.reason,
          evidence: { sessionId: input.mainSession.id },
          actionForm,
        };
      case "manual_only":
        return {
          status: "blocked",
          reason: sessionDecision.reason,
          evidence: { sessionId: input.mainSession.id },
        };
      case "main_session":
        if (config.checkpointType === "input" || config.checkpointType === "choose") {
          return {
            status: "waiting_for_user",
            prompt: config.prompt,
            reason: `Checkpoint node ${input.node.id} requires user input`,
            evidence: { sessionId: input.mainSession.id },
            actionForm,
          };
        }
        return reviewCheckpointNodeCapability({
          ...input,
          aiRuntimeInvoker: this.aiRuntimeInvoker,
        });
    }
  }
}
