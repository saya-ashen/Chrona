import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, summarizeText } from "./logger";

describe("browser logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redacts nested task text and credentials before every console emission", () => {
    vi.stubEnv("VITE_CHRONA_LOG_LEVEL", "debug");
    const output: string[] = [];
    vi.spyOn(console, "debug").mockImplementation((line) => output.push(String(line)));
    vi.spyOn(console, "info").mockImplementation((line) => output.push(String(line)));
    vi.spyOn(console, "warn").mockImplementation((line) => output.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line) => output.push(String(line)));
    const secret = "browser-secret-value-123456";
    const logger = createLogger("schedule");
    const data = {
      task: `Schedule with Bearer ${secret} and https://user:${secret}@example.test/?api_key=${secret}`,
      nested: [{ client_secret: secret }],
    };

    logger.debug("debug", data);
    logger.info("info", data);
    logger.warn("warn", data);
    logger.error("error", data);

    expect(output).toHaveLength(4);
    expect(output.join("\n")).not.toContain(secret);
    expect(output.join("\n")).toContain("[Redacted]");
  });

  it("redacts quick-create-style task text while retaining safe diagnostics", () => {
    const secret = "quick-create-token-123456";
    const summary = summarizeText(`Build report with token=${secret}`);

    expect(summary).not.toContain(secret);
    expect(summary).toContain("[Redacted]");
  });

  it("redacts whitespace-separated credential labels and URL-encoded query labels", () => {
    const apiKey = "opaque-api-key-123456";
    const accessToken = "opaque-access-token-123456";
    const clientSecret = "opaque-client-secret-123456";
    const taskText = [
      `API key: ${apiKey}`,
      `access token=${accessToken}`,
      `client secret: ${clientSecret}`,
      `https://example.test/?api+key=${apiKey}`,
    ].join("; ");
    const summary = summarizeText(taskText, 1_000);

    expect(summary).not.toContain(apiKey);
    expect(summary).not.toContain(accessToken);
    expect(summary).not.toContain(clientSecret);
    expect(summary).toContain("[Redacted]");
  });
});
