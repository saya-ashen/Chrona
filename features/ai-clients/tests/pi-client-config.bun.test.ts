import { describe, expect, it } from "bun:test";
import type { AiClientInfo, RuntimeProviderOption } from "../ui/ai-client-types";
import { buildClientPayload, getInitialFormValues, getProviderFeatures, normalizeRuntimeProviders } from "../ui/ai-client-view-model";

const providers: RuntimeProviderOption[] = [
  { key: "codex", label: "Codex", features: [], recommended: true },
  { key: "pi", label: "Pi", tier: "experimental", features: ["task.plan", "goal.review", "task.execution", "dashboard.brief"] },
];
const client: AiClientInfo = { id: "client-pi", name: "Local Pi", type: "pi", config: {
  provider: "openai-codex", model: "model/with/slashes", cwd: "/work/project", codingAgentDirectory: "~/.pi/agent", timeoutMs: 90_000,
}, enabled: true, isDefault: false, bindings: [], createdAt: "2026-09-10T00:00:00.000Z" };

describe("Pi client settings", () => {
  it("round-trips paths and model while never copying another provider's credentials", () => {
    const values = getInitialFormValues(client, providers, false);
    expect(buildClientPayload({ ...values, apiKey: "do-not-copy", baseUrl: "https://example.invalid" })).toEqual({
      name: "Local Pi", type: "pi", isDefault: false, config: client.config,
    });
  });
  it("clears explicit overrides so Pi can use its own defaults", () => {
    const values = getInitialFormValues(client, providers, false);
    expect(buildClientPayload({ ...values, model: "", provider: "", cwd: "", codingAgentDirectory: "" }).config).toEqual({
      model: null, provider: null, cwd: null, codingAgentDirectory: null, timeoutMs: 90_000,
    });
  });
  it("offers isolated planning/review without replacing the recommended default", () => {
    expect(getProviderFeatures(providers, "pi")).toEqual(providers[1]!.features);
    const normalized = normalizeRuntimeProviders({ providers: [...providers].reverse() });
    expect(normalized[0]?.key).toBe("codex");
    expect(normalized.find((entry) => entry.key === "pi")).toMatchObject({ tier: "experimental", recommended: false });
    expect(getInitialFormValues(undefined, normalized, false).type).toBe("codex");
  });
});
