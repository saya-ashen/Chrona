import { ChronaDebugProviderClient } from "@chrona/providers-debug";
import { HermesProviderClient } from "@chrona/hermes";
import type { AgentProviderClient, ProviderRunSnapshot } from "@chrona/providers-foundation";
import type { AiFeature } from "@chrona/contracts";
import type { ProviderFeatureRequest } from "../packages/engine/src/modules/ai/providers";
import { withProviderResponseFixture } from "../packages/engine/src/test/llm-fixture-recorder";

type CliOptions = {
  provider: "debug" | "hermes";
  feature: AiFeature | string;
  name: string;
  input: unknown;
  instructions?: string;
  sessionKey?: string;
  stream: boolean;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  debugProfile?: string;
};

if (process.env.CHRONA_LLM_FIXTURE_MODE !== "record") {
  console.error("Set CHRONA_LLM_FIXTURE_MODE=record to write LLM fixtures.");
  process.exit(1);
}

if (Bun.argv.slice(2).length === 0) {
  await withProviderResponseFixture(
    {
      sessionId: "debug-chat-fixture",
      sessionKey: "debug-chat-fixture",
      instructions: "Feature: chat",
      input: { message: "Summarize a deterministic test task" },
      stream: false,
    },
    async () => ({
      provider: "debug",
      runId: "debug-chat-fixture-run",
      sessionId: "debug-chat-fixture",
      status: "completed",
      outputText: "Use deterministic fixtures for routine tests.",
      structuredPayload: null,
      error: null,
    }),
    {
      mode: "record",
      provider: "debug",
      feature: "chat",
      name: "valid-small-chat",
    },
  );

  console.log("Recorded debug chat fixture.");
  process.exit(0);
}

function usage() {
  return [
    "Usage:",
    "  CHRONA_LLM_FIXTURE_MODE=record bun run test:llm:record -- --provider debug --feature chat --name valid-small-chat --input '{\"message\":\"Summarize a deterministic test task\"}'",
    "  CHRONA_LLM_FIXTURE_MODE=record bun run test:llm:record -- --provider hermes --feature generate-plan --name valid-small-plan --input-file ./fixtures/plan-input.json --base-url http://127.0.0.1:8642 --api-key $API_SERVER_KEY",
    "",
    "Options:",
    "  --provider debug|hermes       Provider to call. Default: debug",
    "  --feature <name>              Feature directory/name. Default: chat",
    "  --name <cassette>             Cassette file name without .json. Default: valid-small-chat",
    "  --input <json|string>         Request input. JSON object/array preferred.",
    "  --input-file <path>           Read request input from JSON file.",
    "  --instructions <text>         Provider instructions. Default: Feature: <feature>",
    "  --session-key <key>           Stable session key. Default: <provider>-<feature>-<name>",
    "  --stream true|false           Request stream flag. Default: false",
    "  --base-url <url>              Hermes base URL. Or HERMES_BASE_URL / CHRONA_HERMES_BASE_URL.",
    "  --api-key <key>               Hermes API key. Or API_SERVER_KEY / HERMES_API_KEY / CHRONA_HERMES_API_KEY.",
    "  --timeout-ms <number>         Hermes timeout in ms.",
    "  --debug-profile <profile>     Debug provider profile. Or CHRONA_DEBUG_PROFILE.",
  ].join("\n");
}

function takeArgs(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, "true");
      continue;
    }
    values.set(key, next);
    index += 1;
  }
  return values;
}

async function readInput(args: Map<string, string>) {
  const inputFile = args.get("input-file");
  const raw = inputFile
    ? await Bun.file(inputFile).text()
    : args.get("input") ?? JSON.stringify({ message: "Summarize a deterministic test task" });
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function providerFrom(value: string | undefined): CliOptions["provider"] {
  if (!value || value === "debug") return "debug";
  if (value === "hermes") return "hermes";
  throw new Error(`Unsupported provider '${value}'. Use debug or hermes.`);
}

async function parseOptions(): Promise<CliOptions> {
  const args = takeArgs(Bun.argv.slice(2));
  const provider = providerFrom(args.get("provider"));
  const feature = args.get("feature") ?? "chat";
  const name = args.get("name") ?? "valid-small-chat";
  const timeoutMs = args.get("timeout-ms") ? Number(args.get("timeout-ms")) : undefined;
  if (timeoutMs != null && !Number.isFinite(timeoutMs)) {
    throw new Error("--timeout-ms must be a number.");
  }

  return {
    provider,
    feature,
    name,
    input: await readInput(args),
    instructions: args.get("instructions"),
    sessionKey: args.get("session-key"),
    stream: args.get("stream") === "true",
    baseUrl: args.get("base-url") ?? process.env.HERMES_BASE_URL ?? process.env.CHRONA_HERMES_BASE_URL,
    apiKey: args.get("api-key") ?? process.env.API_SERVER_KEY ?? process.env.HERMES_API_KEY ?? process.env.CHRONA_HERMES_API_KEY,
    timeoutMs,
    debugProfile: args.get("debug-profile") ?? process.env.CHRONA_DEBUG_PROFILE,
  };
}

function createProviderClient(options: CliOptions): AgentProviderClient {
  if (options.provider === "debug") {
    return new ChronaDebugProviderClient({ profile: options.debugProfile as never });
  }
  return new HermesProviderClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
  });
}

async function runProviderRequest(
  providerClient: AgentProviderClient,
  request: ProviderFeatureRequest,
): Promise<ProviderRunSnapshot> {
  let finalSnapshot: ProviderRunSnapshot | null = null;
  for await (const event of providerClient.streamRun({
    sessionId: request.sessionId,
    sessionKey: request.sessionKey,
    instructions: request.instructions,
    input: request.input as never,
    structuredOutputSchema: request.structuredOutputSchema,
    maxOutputTokens: request.maxOutputTokens,
    timeoutMs: request.timeoutSeconds ? request.timeoutSeconds * 1000 : undefined,
    stream: true,
  })) {
    if (event.type === "run_completed") {
      finalSnapshot = {
        provider: providerClient.provider,
        runId: event.run.runId,
        nativeRunId: event.run.nativeRunId,
        sessionId: event.run.sessionId,
        status: event.run.status ?? "completed",
        outputText: event.outputText,
        structuredPayload: event.structuredPayload,
        usage: event.usage,
        error: null,
        raw: event.raw,
      };
    }
    if (event.type === "run_failed") {
      finalSnapshot = {
        provider: providerClient.provider,
        runId: event.run?.runId ?? crypto.randomUUID(),
        nativeRunId: event.run?.nativeRunId,
        sessionId: event.run?.sessionId ?? request.sessionId,
        status: "failed",
        error: event.error,
        raw: event.raw,
      };
    }
  }
  if (!finalSnapshot) {
    throw new Error("Provider run finished without a provider snapshot.");
  }
  return finalSnapshot;
}

function sanitizeResponse(response: ProviderRunSnapshot): ProviderRunSnapshot {
  const { raw: _raw, ...safeResponse } = response;
  return safeResponse;
}

const options = await parseOptions();
const sessionKey = options.sessionKey ?? `${options.provider}-${options.feature}-${options.name}`;
const request: ProviderFeatureRequest = {
  sessionId: sessionKey,
  sessionKey,
  instructions: options.instructions ?? `Feature: ${options.feature}`,
  input: options.input,
  stream: options.stream,
};
const providerClient = createProviderClient(options);

await withProviderResponseFixture(
  request,
  () => runProviderRequest(providerClient, request),
  {
    mode: "record",
    provider: options.provider,
    feature: options.feature,
    name: options.name,
    sanitizeRequest: (fixtureRequest) => ({
      sessionKey: fixtureRequest.sessionKey,
      instructions: fixtureRequest.instructions,
      input: fixtureRequest.input,
      stream: fixtureRequest.stream,
    }),
    sanitizeResponse,
  },
);

console.log(`Recorded provider fixture: packages/engine/src/test/llm-fixtures/${options.provider}/${options.feature}/${options.name}.json`);
