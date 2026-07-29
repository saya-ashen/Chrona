import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import type { ProviderFeatureRequest } from "@chrona/engine/test-support";
import { cassettePath, withProviderResponseFixture } from "../../../test/llm-fixture-recorder";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function request(): ProviderFeatureRequest {
  return {
    sessionId: "session-replay-regression",
    sessionKey: "fixture-replay-regression",
    instructions: "Replay only",
    input: { prompt: "hello" },
    stream: false,
  };
}

function snapshot(overrides: Partial<ProviderRunSnapshot> = {}): ProviderRunSnapshot {
  return {
    provider: "debug",
    runId: "run-replay-error",
    sessionId: "session-replay-error",
    status: "failed",
    outputText: undefined,
    structuredPayload: null,
    error: "recorded provider failure",
    ...overrides,
  };
}

describe("provider fixture replay regressions", () => {
  it("replays recorded provider failures without calling the live provider", async () => {
    const cassetteDir = await mkdtemp(join(tmpdir(), "chrona-fixture-replay-"));
    tempDirs.push(cassetteDir);
    const path = cassettePath({ cassetteDir, provider: "debug", feature: "chat", name: "failure" });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      provider: "debug",
      feature: "chat",
      recordedAt: "2026-05-28",
      request: { inputHash: "sha256:test", redactedInput: { input: "safe" } },
      response: snapshot(),
    }), "utf8");

    const result = await withProviderResponseFixture(request(), async () => {
      throw new Error("live provider should not be called in replay mode");
    }, {
      cassetteDir,
      mode: "replay",
      provider: "debug",
      feature: "chat",
      name: "failure",
    });

    expect(result).toMatchObject({
      provider: "debug",
      status: "failed",
      error: "recorded provider failure",
    });
  });
});
