import { z } from "zod";
import {
  createAiJsonObjectSchema,
  manualCompletionFormSchema,
  type AiJsonObject,
  type AiObservationEnvelope,
  type CompletionValidation,
  type ManualCompletionForm,
} from "@chrona/contracts";
import type { NodeActionForm, TaskConfig } from "@chrona/contracts/ai";
import { db } from "@chrona/db";
import {
  defineAiFeature,
  resolveTaskExecutionProviderSelection,
  runAiFeatureWithRuntime,
  stableJsonHash,
} from "@/modules/ai";
import type { NodeExecutorInput } from "./node-executors/types";

const fieldValuesSchema = z.record(
  z.string().min(1),
  z.union([z.string().max(20_000), z.boolean(), z.array(z.string().max(2_000)).max(32)]),
);

const dependencyResultSchema = z.object({
  nodeId: z.string().min(1).max(128),
  title: z.string().min(1).max(512),
  summary: z.string().max(4_000).nullable(),
  inputFields: fieldValuesSchema.nullable(),
}).strict();

export const manualCompletionFormReviewInputSchema = createAiJsonObjectSchema({
  task: z.object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(512),
    description: z.string().max(4_000).nullable(),
  }).strict(),
  plan: z.object({
    title: z.string().min(1).max(512),
    goal: z.string().min(1).max(4_000),
    assumptions: z.array(z.string().max(1_000)).max(64),
  }).strict(),
  node: z.object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(512),
    objective: z.string().min(1).max(4_000),
    expectedOutput: z.string().max(4_000).nullable(),
    completionCriteria: z.string().max(4_000).nullable(),
  }).strict(),
  candidateForm: manualCompletionFormSchema.nullable(),
  relevantPreviousResults: z.array(dependencyResultSchema).max(32),
});

export const manualCompletionFormReviewOutputSchema = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("sufficient") }).strict(),
  z.object({ verdict: z.literal("replace"), form: manualCompletionFormSchema }).strict(),
]);

export type ManualCompletionFormReviewInput = z.infer<typeof manualCompletionFormReviewInputSchema>;
export type ManualCompletionFormReviewOutput = z.infer<typeof manualCompletionFormReviewOutputSchema>;

const FEATURE = { id: "task.manual-completion-form.review", version: 1 } as const;
const OBSERVATION = { id: "task.manual-completion-form.context", version: 1 } as const;

function observation(input: ManualCompletionFormReviewInput): AiObservationEnvelope {
  const data = input as AiJsonObject;
  return {
    observationId: `manual-form-${stableJsonHash(data).slice("sha256:".length, "sha256:".length + 24)}`,
    type: OBSERVATION,
    key: input.node.id,
    revision: stableJsonHash(data),
    observedAt: new Date().toISOString(),
    canonicalizerId: "chrona.stable-json.v1",
    hashAlgorithm: "sha256",
    contentHash: stableJsonHash(data),
    data,
  };
}

export const manualCompletionFormReviewFeature = defineAiFeature({
  manifest: {
    schemaVersion: 1,
    feature: FEATURE,
    description: "Validate or replace the structured completion form for one manual task node.",
    input: { id: "task.manual-completion-form.review.input", version: 1 },
    observations: [{ observation: OBSERVATION, delivery: { kind: "seed" }, required: true, maxBytes: 512 * 1024 }],
    actions: [],
    artifacts: [],
    output: { id: "task.manual-completion-form.review.output", version: 1 },
    completion: { id: "task.manual-completion-form.review.completion", version: 1 },
    supportedTerminalStatuses: ["completed"],
  },
  providerBindingFeature: "task.execution",
  inputSchema: manualCompletionFormReviewInputSchema,
  outputSchema: manualCompletionFormReviewOutputSchema,
  subjectSchema: z.object({
    type: z.literal("task_node_attempt"),
    id: z.string().min(1).max(128),
  }).strict(),
  resolveSubject: ({ subject }) => subject,
  buildObjective: (input) => ({
    statement: `Review the completion form for manual step: ${input.node.title}.`,
    expectedOutcome: "Either confirm the candidate form is sufficient or return one complete replacement form.",
    successCriteria: [
      "The final form captures the node expected output and completion criteria.",
      "The final form is concise and safe for a normal user to complete.",
    ],
    constraints: [
      "Never request passwords, API keys, tokens, credentials, permission decisions, or authorization decisions.",
      "Return a full replacement form instead of a patch when the candidate is insufficient or absent.",
    ],
  }),
  buildInstructions: ({ input }) => [
    "Review the candidate completion form using the frozen task, plan, node, and dependency context.",
    "If the candidate is complete and appropriate, return completed output { verdict: 'sufficient' }.",
    "If it is absent or insufficient, return completed output { verdict: 'replace', form: <complete valid form> }.",
    "Do not return partial edits. The replacement must contain 1-12 uniquely named fields using only text, choice, or boolean kinds.",
    "Fields must collect completion evidence, not secrets, credentials, permission decisions, or authorization decisions.",
    `Node: ${input.node.title}. Expected output: ${input.node.expectedOutput ?? "not specified"}. Completion criteria: ${input.node.completionCriteria ?? "not specified"}.`,
  ].join("\n"),
  observations: [{
    binding: { observation: OBSERVATION },
    build: ({ input }) => observation(manualCompletionFormReviewInputSchema.parse(input)),
  }],
  actions: [],
  // eslint-disable-next-line complexity -- validation keeps every terminal contract check explicit.
  validateCompletion: ({ input, result, observations }): CompletionValidation => {
    const parsedInput = manualCompletionFormReviewInputSchema.safeParse(input);
    const parsedOutput = manualCompletionFormReviewOutputSchema.safeParse(result.output);
    const output = parsedOutput.success ? parsedOutput.data : null;
    const candidateIsRequired = output?.verdict === "sufficient";
    const valid = parsedInput.success
      && parsedOutput.success
      && observations.length === 1
      && result.artifacts.length === 0
      && result.proposedActions.length === 0
      && (!candidateIsRequired || parsedInput.data.candidateForm !== null);
    return {
      valid,
      validator: { id: "task.manual-completion-form.review.validator", version: 1 },
      issues: valid ? [] : [{
        code: "manual_form_review_invalid",
        path: "/output",
        message: candidateIsRequired && parsedInput.success && parsedInput.data.candidateForm === null
          ? "A missing or invalid candidate form cannot be marked sufficient."
          : "Manual completion form review returned an invalid terminal result.",
      }],
    };
  },
});

export type ManualCompletionFormReviewErrorCode =
  | "MANUAL_FORM_PROVIDER_UNAVAILABLE"
  | "MANUAL_FORM_REVIEW_PROVIDER_FAILED"
  | "MANUAL_FORM_REVIEW_RESULT_INVALID"
  | "MANUAL_FORM_POLICY_INVALID";

export class ManualCompletionFormReviewError extends Error {
  constructor(
    public readonly code: ManualCompletionFormReviewErrorCode,
    message: string,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = "ManualCompletionFormReviewError";
  }
}

function bounded(value: string | undefined, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function boundedInputFields(value: Record<string, string | boolean | string[]> | undefined) {
  if (!value) return null;
  return Object.fromEntries(
    Object.entries(value).slice(0, 32).map(([key, fieldValue]) => [
      key.slice(0, 128),
      Array.isArray(fieldValue)
        ? fieldValue.slice(0, 32).map((item) => item.slice(0, 2_000))
        : typeof fieldValue === "string"
          ? fieldValue.slice(0, 20_000)
          : fieldValue,
    ]),
  );
}

function reviewInput(input: NodeExecutorInput, task: { id: string; title: string; description: string | null }): ManualCompletionFormReviewInput {
  const config = input.node.config as TaskConfig;
  const candidate = manualCompletionFormSchema.safeParse(config.completionForm);
  const dependencyIds = new Set(input.node.dependencies);
  return manualCompletionFormReviewInputSchema.parse({
    task: {
      id: task.id,
      title: task.title.slice(0, 512),
      description: bounded(task.description ?? undefined, 4_000),
    },
    plan: {
      title: input.planContext?.title.slice(0, 512) ?? input.plan.basePlanId.slice(0, 512),
      goal: input.planContext?.goal.slice(0, 4_000) ?? input.node.definition.objective.slice(0, 4_000),
      assumptions: (input.planContext?.assumptions ?? []).slice(0, 64).map((value) => value.slice(0, 1_000)),
    },
    node: {
      id: input.node.id,
      title: input.node.title.slice(0, 512),
      objective: input.node.definition.objective.slice(0, 4_000),
      expectedOutput: bounded(config.expectedOutput, 4_000),
      completionCriteria: bounded(config.completionCriteria, 4_000),
    },
    candidateForm: candidate.success ? candidate.data : null,
    relevantPreviousResults: input.plan.nodes
      .filter((node) => dependencyIds.has(node.id) && node.result)
      .slice(0, 32)
      .map((node) => ({
        nodeId: node.id,
        title: node.title.slice(0, 512),
        summary: bounded(node.result?.outputSummary, 4_000),
        inputFields: boundedInputFields(node.result?.inputFields),
      })),
  });
}

function errorCodeForRun(code: string | undefined): ManualCompletionFormReviewErrorCode {
  if (code === "output_invalid" || code === "result_invalid" || code === "completion_invalid") {
    return "MANUAL_FORM_REVIEW_RESULT_INVALID";
  }
  if (code === "input_invalid" || code === "observation_invalid") {
    return "MANUAL_FORM_POLICY_INVALID";
  }
  return "MANUAL_FORM_REVIEW_PROVIDER_FAILED";
}

// eslint-disable-next-line complexity -- provider resolution and fail-closed result validation are one use case.
export async function reviewManualCompletionForm(input: NodeExecutorInput): Promise<NodeActionForm> {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, workspaceId: true, title: true, description: true, aiClientId: true },
  });
  if (!task) throw new ManualCompletionFormReviewError("MANUAL_FORM_POLICY_INVALID", "Task no longer exists.");

  const provider = await resolveTaskExecutionProviderSelection({ aiClientId: task.aiClientId });
  if (!provider) {
    throw new ManualCompletionFormReviewError(
      "MANUAL_FORM_PROVIDER_UNAVAILABLE",
      "No enabled AI Provider is configured for this task.",
    );
  }

  let featureInput: ManualCompletionFormReviewInput;
  try {
    featureInput = reviewInput(input, task);
  } catch {
    throw new ManualCompletionFormReviewError(
      "MANUAL_FORM_POLICY_INVALID",
      "Manual completion form review context violated Chrona policy.",
    );
  }
  let run;
  try {
    run = await runAiFeatureWithRuntime({
      workspaceId: task.workspaceId,
      definition: manualCompletionFormReviewFeature,
      subject: { type: "task_node_attempt", id: input.attempt.id },
      operation: { kind: "manual_form_review", operationId: input.attempt.id },
      input: featureInput,
    }, {
      signal: input.signal,
      providerBinding: {
        providerClientId: provider.clientId,
        providerName: provider.providerName,
        providerConfigFingerprint: provider.configFingerprint,
      },
    });
  } catch (cause) {
    throw new ManualCompletionFormReviewError(
      "MANUAL_FORM_REVIEW_PROVIDER_FAILED",
      cause instanceof Error ? cause.message : "The AI Provider could not prepare the manual completion form.",
    );
  }

  if (run.status !== "completed" || run.result?.status !== "completed") {
    throw new ManualCompletionFormReviewError(
      errorCodeForRun(run.error?.code),
      run.error?.message ?? "The AI Provider could not prepare a valid manual completion form.",
      run.id,
    );
  }

  const output = manualCompletionFormReviewOutputSchema.safeParse(run.result.output);
  if (!output.success) {
    throw new ManualCompletionFormReviewError(
      "MANUAL_FORM_REVIEW_RESULT_INVALID",
      "The AI Provider returned an invalid manual completion form result.",
      run.id,
    );
  }

  const candidate = manualCompletionFormSchema.safeParse(featureInput.candidateForm);
  const selected: { form: ManualCompletionForm; source: "plan" | "runtime_ai" } = output.data.verdict === "sufficient"
    ? candidate.success
      ? { form: candidate.data, source: "plan" }
      : (() => { throw new ManualCompletionFormReviewError("MANUAL_FORM_REVIEW_RESULT_INVALID", "The AI Provider accepted a missing manual completion form.", run.id); })()
    : { form: output.data.form, source: "runtime_ai" };

  const validated = manualCompletionFormSchema.safeParse(selected.form);
  if (!validated.success) {
    throw new ManualCompletionFormReviewError(
      "MANUAL_FORM_POLICY_INVALID",
      "The reviewed manual completion form violated Chrona form policy.",
      run.id,
    );
  }

  return {
    ...validated.data,
    revision: stableJsonHash(validated.data),
    source: selected.source,
    validated: true,
  };
}
