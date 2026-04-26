import { describe, expect, it } from "bun:test";

import { buildOpenClawSessionIdentity } from "./session";

describe("OpenClaw session identity", () => {
  it("builds short stable session ids while preserving meaningful session keys", () => {
    const identity = buildOpenClawSessionIdentity(
      "generate_plan",
      "chrona:openclaw:task:task-001:default",
    );

    expect(identity.sessionKey).toBe("chrona:openclaw:task:task-001:default");
    expect(identity.sessionId).toStartWith("ai-generate_plan-");
    expect(identity.sessionId).toMatch(/-\d{8}-\d{6}-[a-f0-9]{10}$/);
    expect(identity.sessionId.length).toBeLessThanOrEqual(100);
  });

  it("caps long adhoc scopes to a safe session id length", () => {
    const identity = buildOpenClawSessionIdentity(
      "generate_plan",
      "adhoc-" + "非常长的标题".repeat(40),
    );

    expect(identity.sessionId.length).toBeLessThanOrEqual(100);
    expect(identity.sessionKey.length).toBeGreaterThan(20);
  });
});
