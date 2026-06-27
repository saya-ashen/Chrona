import { createHash, randomUUID } from "node:crypto";

import {
  buildGeneratePlanFeatureSpec,
  type GenerateTaskPlanRequest,
  type StreamEvent,
} from "@chrona/contracts";
import type { EngineAiClient } from "../../../../../../features/ai-clients";
import {
  dispatchStream,
  prepareStreamInput,
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
  for await (const event of generator) {
    yield event;
  }
}
