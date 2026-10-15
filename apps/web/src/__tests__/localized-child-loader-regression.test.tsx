import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router-dom";
import { apiJson } from "../../../../shared/http/api-client";
import { loadAppBootData } from "../loaders";

vi.mock("../../../../shared/http/api-client", () => ({ apiJson: vi.fn() }));
const args: LoaderFunctionArgs = { params: { lang: "en" }, request: new Request("http://localhost/en"), url: new URL("http://localhost/en"), pattern: "/:lang", context: {} };
beforeEach(() => vi.resetAllMocks());
describe("steward workspace boot", () => {
  it("selects the first owner workspace from the list endpoint", async () => {
    vi.mocked(apiJson).mockResolvedValue([{ id: "ws-1", name: "Owner" }, { id: "ws-2", name: "Other" }]);
    const data = await loadAppBootData(args);
    expect(data.defaultWorkspace).toEqual({ id: "ws-1", name: "Owner" });
    expect(apiJson).toHaveBeenCalledWith("http://localhost/api/workspaces");
  });
  it("does not render without a workspace", async () => {
    vi.mocked(apiJson).mockResolvedValue([]);
    await expect(loadAppBootData(args)).rejects.toMatchObject({ status: 503 });
  });
  it("preserves authentication failures for the access-key boundary", async () => {
    const error = new Response(null, { status: 401 });
    vi.mocked(apiJson).mockRejectedValue(error);
    await expect(loadAppBootData(args)).rejects.toBe(error);
  });
});
