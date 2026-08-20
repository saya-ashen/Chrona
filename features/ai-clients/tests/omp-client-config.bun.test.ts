import { describe, expect, it } from "bun:test";
import type { AiClientInfo, RuntimeProviderOption } from "../ui/ai-client-types";
import {
  buildClientPayload,
  getInitialFormValues,
} from "../ui/ai-client-view-model";

const providers: RuntimeProviderOption[] = [
  { key: "omp", label: "Oh My Pi", features: ["task.plan"] },
];

function ompClient(config: Record<string, unknown>): AiClientInfo {
  return {
    id: "client-omp",
    name: "OMP",
    type: "omp",
    config,
    isDefault: true,
    enabled: true,
    bindings: ["task.plan"],
    createdAt: "2026-08-19T00:00:00.000Z",
  };
}

describe("OMP client configuration", () => {
  it("round-trips provider, slash-containing model ID, API type, and connection settings", () => {
    const values = getInitialFormValues(
      ompClient({
        provider: "nrouter",
        model: "cx/gpt-5.6-sol",
        api: "openai-responses",
        baseUrl: "https://llm.example.test/v1",
        apiKey: "sk-omp",
        homeDirectory: "/home/omp",
        configDirectory: "/home/omp/.omp",
        codingAgentDirectory: "/home/omp/.omp/agent",
        timeoutMs: 90_000,
      }),
      providers,
      false,
    );

    expect(values).toMatchObject({
      provider: "nrouter",
      model: "cx/gpt-5.6-sol",
      api: "openai-responses",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "sk-omp",
      timeoutSeconds: "90",
    });
    expect(buildClientPayload(values)).toEqual({
      name: "OMP",
      type: "omp",
      isDefault: true,
      config: {
        provider: "nrouter",
        model: "cx/gpt-5.6-sol",
        api: "openai-responses",
        apiKey: "sk-omp",
        baseUrl: "https://llm.example.test/v1",
        homeDirectory: "/home/omp",
        configDirectory: "/home/omp/.omp",
        codingAgentDirectory: "/home/omp/.omp/agent",
        timeoutMs: 90_000,
      },
    });
  });

  it("keeps legacy selector models and defaults unknown API values safely", () => {
    const values = getInitialFormValues(
      ompClient({ model: "nrouter/cx/gpt-5.6-sol", api: "unknown" }),
      providers,
      false,
    );

    expect(values.provider).toBe("");
    expect(values.model).toBe("nrouter/cx/gpt-5.6-sol");
    expect(values.api).toBe("openai-responses");
  });
});
