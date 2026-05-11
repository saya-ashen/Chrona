import { createHash } from "node:crypto";

import {
  buildGeneratePlanFeatureSpec,
  type EditablePlan,
  type GenerateTaskPlanRequest,
  type StreamEvent,
} from "@chrona/contracts";
import { createDebugDump, previewDebugValue } from "@chrona/shared/debug-dump";
import type { EngineAiClient } from "../runtime/client-registry";
import {
  buildGeneratePlanDiagnostics,
  describeGeneratePlanFailure,
  dispatchStream,
  extractPreferredPlanGraphFromStructured,
  prepareStreamInput,
  summarizeStreamEvent,
} from "../streaming";
import { normalizeGeneratePlanResponse } from "../feature-normalizers";

type GeneratePlanAccumulator = {
  finalText: string;
  latestToolInput: Record<string, unknown> | null;
};

function asciiSlug(value: string, maxLength: number): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/^-|-$/g, "");
  return normalized || "input";
}

export function buildGeneratePlanScope(request: GenerateTaskPlanRequest): string {
  if (request.sessionKey?.trim()) {
    return request.sessionKey.trim();
  }
  const taskPart = request.taskId?.trim();
  if (taskPart) {
    return `chrona:openclaw:task:${taskPart}:default`;
  }
  const titlePart = asciiSlug(request.title, 120) || "untitled";
  const titleHash = createHash("sha1").update(request.title).digest("hex").slice(0, 8);
  const nonce = Math.random().toString(36).slice(2, 10);
  return `adhoc-${titlePart}-${titleHash}-${nonce}`;
}

function hasNonEmptyPlanBlueprint(
  plan: unknown,
): plan is { blueprint: { nodes: unknown[] } } {
  if (!plan || typeof plan !== "object") {
    return false;
  }

  const blueprint = (plan as { blueprint?: unknown }).blueprint;
  if (!blueprint || typeof blueprint !== "object") {
    return false;
  }

  const nodes = (blueprint as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) && nodes.length > 0;
}

function collectGeneratePlanResult(
  acc: GeneratePlanAccumulator,
  doneEvent: Extract<StreamEvent, { type: "done" }>,
  source: string,
): StreamEvent {
  const text = doneEvent.text ?? acc.finalText;
  const structuredToolGraph = extractPreferredPlanGraphFromStructured(
    doneEvent.structured ?? null,
  );

  let parsed = (acc.latestToolInput ?? structuredToolGraph ?? null) as EditablePlan | null;
  if (!acc.latestToolInput && !structuredToolGraph) {
    try {
      parsed = text ? (JSON.parse(text) as EditablePlan) : null;
    } catch {
      parsed = null;
    }
  }

  const normalized = normalizeGeneratePlanResponse({
    parsed,
    source,
    structured: doneEvent.structured,
  });
  const plan = normalized.plan;
  if (!hasNonEmptyPlanBlueprint(plan)) {
    const diagnostics = buildGeneratePlanDiagnostics({
      text,
      structured: doneEvent.structured ?? null,
      latestToolInput: acc.latestToolInput,
      structuredToolGraph,
      validationErrors: normalized.validationErrors,
      validationWarnings: normalized.validationWarnings,
    });
    return {
      type: "error",
      message: `${describeGeneratePlanFailure({ text, structured: doneEvent.structured ?? null, latestToolInput: acc.latestToolInput, structuredToolGraph, validationErrors: normalized.validationErrors })} Normalized plan blueprint contained zero nodes.`,
      rawText: text,
      structured: doneEvent.structured ?? null,
      diagnostics,
    };
  }

  return { type: "result", plan };
}

export async function* generatePlanStream(
  client: EngineAiClient,
  request: GenerateTaskPlanRequest,
): AsyncGenerator<StreamEvent> {
  const featureSpec = buildGeneratePlanFeatureSpec(request);
  const preparedInput = prepareStreamInput(
    buildGeneratePlanScope(request),
    request,
    featureSpec,
  );
  const generator = dispatchStream(client, "generate_plan", preparedInput);
  const dump = await createDebugDump({
    enabledEnv: "CHRONA_AI_STREAM_DUMP",
    directoryEnv: "CHRONA_AI_STREAM_DUMP_DIR",
    kind: "ai-stream",
    label: `generate-plan-${request.taskId ?? preparedInput.scope}`,
    meta: {
      layer: "engine.ai.features.generatePlanStream",
      clientType: client.record.type,
      taskId: request.taskId ?? null,
      scope: preparedInput.scope,
    },
  });
  const acc: GeneratePlanAccumulator = { finalText: "", latestToolInput: null };
  let latestStructured: NonNullable<
    Extract<StreamEvent, { type: "done" }>["structured"]
  > | null = null;

  for await (const event of generator) {
    await dump?.write({ type: "input_event", event: summarizeStreamEvent(event) });
    if (event.type === "tool_call" && event.tool === "generate_task_plan_graph") {
      acc.latestToolInput = event.input;
      await dump?.write({
        type: "accumulator",
        field: "latestToolInput",
        value: previewDebugValue(acc.latestToolInput, 1200),
      });
      await dump?.write({ type: "yield", event: summarizeStreamEvent(event) });
      yield event;
      continue;
    }

    if (event.type === "partial") {
      acc.finalText += event.text;
      await dump?.write({
        type: "accumulator",
        field: "finalText",
        textLength: acc.finalText.length,
      });
      await dump?.write({ type: "yield", event: summarizeStreamEvent(event) });
      yield event;
      continue;
    }

    if (event.type === "done") {
      latestStructured = event.structured ?? null;
      const resolved = collectGeneratePlanResult(acc, event, client.record.type);
      await dump?.write({
        type: "resolved",
        event: summarizeStreamEvent(resolved),
        hasLatestToolInput: Boolean(acc.latestToolInput),
        finalTextLength: acc.finalText.length,
      });
      yield resolved;
      if (resolved.type === "result") {
        const doneEvent: StreamEvent = {
          type: "done",
          text: event.text ?? acc.finalText,
          structured: latestStructured ?? null,
        };
        await dump?.write({ type: "yield", event: summarizeStreamEvent(doneEvent) });
        yield doneEvent;
      }
      await dump?.close();
      return;
    }

    await dump?.write({ type: "yield", event: summarizeStreamEvent(event) });
    yield event;
  }

  await dump?.write({ type: "generator_exhausted" });
  await dump?.close();
}
