import { createHash, randomUUID } from "node:crypto";

import {
  buildGeneratePlanFeatureSpec,
  type GenerateTaskPlanRequest,
  type StreamEvent,
} from "@chrona/contracts";
import { createDebugDump } from "@chrona/shared/debug-dump";
import type { EngineAiClient } from "../runtime/client-registry";
import {
  dispatchStream,
  prepareStreamInput,
  summarizeStreamEvent,
} from "../streaming";

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

export function buildGeneratePlanScope(
  request: GenerateTaskPlanRequest,
): string {
  if (request.sessionKey?.trim()) {
    return request.sessionKey.trim();
  }
  const taskPart = request.taskId?.trim();
  if (taskPart) {
    return `chrona:task:${taskPart}:default`;
  }
  const titlePart = asciiSlug(request.title, 120) || "untitled";
  const titleHash = createHash("sha256")
    .update(request.title)
    .digest("hex")
    .slice(0, 8);
  const nonce = randomUUID().slice(0, 8);
  return `adhoc-${titlePart}-${titleHash}-${nonce}`;
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
  for await (const event of generator) {
    await dump?.write({
      type: "input_event",
      event: summarizeStreamEvent(event),
    });
    await dump?.write({ type: "yield", event: summarizeStreamEvent(event) });
    yield event;
    if (event.type === "done") {
      await dump?.close();
      return;
    }
  }

  await dump?.write({ type: "generator_exhausted" });
  await dump?.close();
}
