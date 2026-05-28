import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AiFeature } from "@chrona/contracts";
import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import type { ProviderFeatureRequest } from "../modules/ai/providers";

const DEFAULT_CASSETTE_DIR = "packages/engine/src/test/llm-fixtures";

export type LlmFixtureMode = "off" | "record" | "replay";

export interface ProviderResponseFixtureCassette {
  schemaVersion: 1;
  provider: string;
  feature: AiFeature | string;
  recordedAt: string;
  request: {
    inputHash: string;
    redactedInput: unknown;
  };
  response: ProviderRunSnapshot;
}

export interface LlmFixtureRecorderOptions {
  cassetteDir?: string;
  mode?: LlmFixtureMode;
  provider: string;
  feature: AiFeature | string;
  name: string;
  sanitizeRequest?: (request: ProviderFeatureRequest) => unknown;
  sanitizeResponse?: (response: ProviderRunSnapshot) => ProviderRunSnapshot;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) return child;
    return Object.fromEntries(Object.entries(child).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function requestHash(request: ProviderFeatureRequest): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`;
}

export function getLlmFixtureMode(): LlmFixtureMode {
  const value = process.env.CHRONA_LLM_FIXTURE_MODE;
  if (value === "record" || value === "replay") return value;
  return "off";
}

export function cassettePath(options: Pick<LlmFixtureRecorderOptions, "cassetteDir" | "provider" | "feature" | "name">) {
  return join(
    options.cassetteDir ?? DEFAULT_CASSETTE_DIR,
    options.provider,
    String(options.feature),
    `${options.name}.json`,
  );
}

export async function readProviderResponseFixture(path: string): Promise<ProviderResponseFixtureCassette> {
  return JSON.parse(await readFile(path, "utf8")) as ProviderResponseFixtureCassette;
}

export async function withProviderResponseFixture(
  request: ProviderFeatureRequest,
  runProviderRequest: () => Promise<ProviderRunSnapshot>,
  options: LlmFixtureRecorderOptions,
): Promise<ProviderRunSnapshot> {
  const mode = options.mode ?? getLlmFixtureMode();
  if (mode === "off") return await runProviderRequest();

  const path = cassettePath(options);
  if (mode === "replay") {
    const cassette = await readProviderResponseFixture(path);
    return cassette.response;
  }

  const response = await runProviderRequest();
  const cassette: ProviderResponseFixtureCassette = {
    schemaVersion: 1,
    provider: options.provider,
    feature: options.feature,
    recordedAt: new Date().toISOString().slice(0, 10),
    request: {
      inputHash: requestHash(request),
      redactedInput: options.sanitizeRequest?.(request) ?? {
        sessionKey: request.sessionKey,
        instructions: request.instructions,
        input: request.input,
        stream: request.stream,
      },
    },
    response: options.sanitizeResponse?.(response) ?? response,
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(cassette)}\n`);
  return response;
}
