import { describe, expect, it } from "vitest";

import { readinessItems } from "../ui/ai-client-readiness";
import { isFeatureAssignedToClient } from "../ui/ai-client-list";
import { getProviderFeatures } from "../ui/ai-client-view-model";

const copy = new Proxy<Record<string, string>>({}, {
  get: (_target, property) => String(property),
});

describe("AI client readiness", () => {
  it("treats an available default OMP client as planning-ready", () => {
    const items = readinessItems({
      copy,
      type: "omp",
      configured: true,
      enabled: true,
      testStatus: "available",
      testReason: null,
      isDefault: true,
      bindings: [],
    });

    expect(items.find(({ key }) => key === "overall")).toMatchObject({ state: "ready", detail: "readinessCapabilityDetail" });
  });

  it("does not assign a shadowed default client to planning or execution", () => {
    const defaultClient = { id: "default-client", isDefault: true, bindings: [] };
    const boundClient = { id: "bound-client", isDefault: false, bindings: ["task.plan", "task.execution"] };
    const clients = [defaultClient, boundClient];
    const assignedToPlanning = isFeatureAssignedToClient(defaultClient, clients, "task.plan");
    const assignedToExecution = isFeatureAssignedToClient(defaultClient, clients, "task.execution");

    expect(assignedToPlanning).toBe(false);
    expect(assignedToExecution).toBe(false);
    const items = readinessItems({
      copy,
      type: "omp",
      configured: true,
      enabled: true,
      testStatus: "available",
      testReason: null,
      isDefault: true,
      bindings: [],
      assignedToPlanning,
      assignedToExecution,
    });

    expect(items.find(({ key }) => key === "overall")?.state).toBe("pending");
  });

  it("treats an available execution-only provider as ready for its assigned feature", () => {
    const items = readinessItems({
      copy,
      type: "claude_code",
      configured: true,
      enabled: true,
      testStatus: "available",
      testReason: null,
      isDefault: false,
      bindings: ["task.execution"],
      assignedToPlanning: false,
      assignedToExecution: true,
    });

    expect(items.find(({ key }) => key === "overall")).toMatchObject({
      state: "ready",
      detail: "readinessCapabilityDetail",
    });
  });

  it("keeps overall readiness pending while availability is being tested", () => {
    const items = readinessItems({
      copy,
      type: "omp",
      configured: true,
      enabled: true,
      testStatus: "testing",
      testReason: null,
      isDefault: true,
      bindings: [],
    });

    const overall = items.find(({ key }) => key === "overall");
    expect(overall?.state).toBe("pending");
    expect(overall?.detail).not.toContain("unreachable");
  });

  it("offers proposal-only bindings for single-attempt OMP", () => {
    const features = getProviderFeatures([{
      key: "omp",
      label: "Oh My Pi",
      features: ["goal.review", "task.plan", "task.execution"],
    }], "omp");

    expect(features).toEqual(["goal.review", "task.plan", "task.execution"]);
  });
});
