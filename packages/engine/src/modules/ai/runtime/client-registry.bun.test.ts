import { describe, expect, it } from "bun:test";
import { getProviderBaseUrl } from "./client-registry";

describe("AI client registry", () => {
  it("normalizes provider base URLs", () => {
    expect(
      getProviderBaseUrl({
        baseUrl: "127.0.0.1:8642/",
      }),
    ).toBe("http://127.0.0.1:8642");
  });
});
