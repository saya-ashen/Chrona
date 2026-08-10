import { describe, expect, it } from "bun:test";
import { providerApprovalResolutionMatchesRequest } from "./resolve-provider-approval";

const request = {
  provider: "hermes",
  runId: "provider-run-1",
  nativeRunId: "native-run-1",
  choice: "approve_once" as const,
};

const resolution = {
  ...request,
  resolved: 1,
  status: "resolved" as const,
};

describe("provider approval resolution receipt identity", () => {
  it("accepts only the exact provider, run, native run, and choice receipt", () => {
    expect(providerApprovalResolutionMatchesRequest({ resolution, ...request })).toBe(true);
    expect(providerApprovalResolutionMatchesRequest({
      resolution: { ...resolution, provider: "other-provider" },
      ...request,
    })).toBe(false);
    expect(providerApprovalResolutionMatchesRequest({
      resolution: { ...resolution, runId: "provider-run-2" },
      ...request,
    })).toBe(false);
    expect(providerApprovalResolutionMatchesRequest({
      resolution: { ...resolution, nativeRunId: "native-run-2" },
      ...request,
    })).toBe(false);
    expect(providerApprovalResolutionMatchesRequest({
      resolution: { ...resolution, choice: "deny" },
      ...request,
    })).toBe(false);
  });

  it("rejects a native run identity when none was requested", () => {
    expect(providerApprovalResolutionMatchesRequest({
      resolution: { ...resolution, nativeRunId: "unexpected-native-run" },
      provider: request.provider,
      runId: request.runId,
      choice: request.choice,
    })).toBe(false);
  });
});
