import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiJson } from "../../../../shared/http/api-client";
import { loadGoalWorkspaceData } from "../loaders";

vi.mock("../../../../shared/http/api-client", () => ({
  apiJson: vi.fn(),
}));

describe("loadGoalWorkspaceData", () => {
  beforeEach(() => {
    vi.mocked(apiJson).mockReset();
  });

  it("requests archived assets when the archived Workbench deep link is loaded", async () => {
    vi.mocked(apiJson)
      .mockResolvedValueOnce({ id: "goal-1", workspaceId: "ws-1" })
      .mockResolvedValueOnce({ assets: [], recent: [] })
      .mockResolvedValueOnce({ candidates: [] });

    await loadGoalWorkspaceData({
      params: { goalId: "goal-1" },
      request: new Request(
        "http://chrona.test/zh/goals/goal-1?section=workbench&assetState=archived",
      ),
      context: undefined,
      unstable_url: new URL("http://chrona.test/zh/goals/goal-1"),
      unstable_pattern: "/:lang/goals/:goalId",
    });
    expect(apiJson).toHaveBeenNthCalledWith(
      2,
      "http://chrona.test/api/goals/goal-1/assets?workspaceId=ws-1&state=archived",
    );
  });

  it("keeps the default asset request restricted to active assets", async () => {
    vi.mocked(apiJson)
      .mockResolvedValueOnce({ id: "goal-1", workspaceId: "ws-1" })
      .mockResolvedValueOnce({ assets: [], recent: [] })
      .mockResolvedValueOnce({ candidates: [] });

    await loadGoalWorkspaceData({
      params: { goalId: "goal-1" },
      request: new Request("http://chrona.test/zh/goals/goal-1?section=workbench"),
      context: undefined,
      unstable_url: new URL("http://chrona.test/zh/goals/goal-1"),
      unstable_pattern: "/:lang/goals/:goalId",
    });
    expect(apiJson).toHaveBeenNthCalledWith(
      2,
      "http://chrona.test/api/goals/goal-1/assets?workspaceId=ws-1",
    );
  });
});
