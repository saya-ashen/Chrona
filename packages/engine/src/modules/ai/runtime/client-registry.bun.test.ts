import { describe, expect, it } from "bun:test";
import { getOpenClawGatewayUrl } from "./client-registry";

describe("AI client registry", () => {
  it("uses legacy OpenClaw baseUrl when gatewayUrl is absent", () => {
    expect(
      getOpenClawGatewayUrl({
        baseUrl: "127.0.0.1:8642/",
        bridgeUrl: "",
        bridgeToken: "",
      }),
    ).toBe("http://127.0.0.1:8642");
  });
});
