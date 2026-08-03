import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import type { ProviderRunSnapshot, StartRunInput } from "@chrona/providers-foundation";
import { cassettePath, withProviderResponseFixture } from "./llm-fixture-recorder";

const tempDirs: string[] = [];

async function tempCassetteDir() {
  const dir = await mkdtemp(join(tmpdir(), "chrona-llm-fixtures-"));
  tempDirs.push(dir);
  return dir;
}

function request(overrides: Partial<StartRunInput> = {}): StartRunInput {
  return {
    clientOperationId: "llm-fixture-recorder-request",
    sessionId: "session-1",
    sessionKey: "fixture-session",
    instructions: "Use synthetic fixture data only",
    input: { task: "synthetic" },
    stream: false,
    ...overrides,
  };
}

function response(overrides: Partial<ProviderRunSnapshot> = {}): ProviderRunSnapshot {
  return {
    provider: "debug",
    runId: "run-1",
    sessionId: "session-1",
    status: "completed",
    outputText: "Recorded fixture response",
    structuredPayload: null,
    error: null,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("LLM fixture recorder", () => {
  test("builds deterministic cassette paths", () => {
    expect(cassettePath({ cassetteDir: "fixtures", provider: "debug", feature: "chat", name: "small" }))
      .toBe("fixtures/debug/chat/small.json");
  });

  test("off mode calls provider without writing a cassette", async () => {
    let calls = 0;

    const snapshot = await withProviderResponseFixture(request(), async () => {
      calls += 1;
      return response();
    }, {
      cassetteDir: await tempCassetteDir(),
      feature: "chat",
      mode: "off",
      name: "off-mode",
      provider: "debug",
    });

    expect(calls).toBe(1);
    expect(snapshot.outputText).toBe("Recorded fixture response");
  });

  test("record mode writes sanitized provider-level cassette data", async () => {
    const cassetteDir = await tempCassetteDir();
    const snapshot = response({ raw: { token: "secret-token" } });

    await withProviderResponseFixture(request({ input: { secret: "do-not-store" } }), async () => snapshot, {
      cassetteDir,
      feature: "chat",
      mode: "record",
      name: "recorded",
      provider: "debug",
      sanitizeRequest: (providerRequest) => ({ sessionKey: providerRequest.sessionKey, input: "redacted" }),
      sanitizeResponse: (providerResponse) => ({ ...providerResponse, raw: undefined }),
    });

    const raw = await readFile(join(cassetteDir, "debug", "chat", "recorded.json"), "utf8");
    const cassette = JSON.parse(raw);

    expect(cassette).toMatchObject({
      schemaVersion: 1,
      provider: "debug",
      feature: "chat",
      request: {
        inputHash: expect.stringMatching(/^sha256:/),
        redactedInput: { sessionKey: "fixture-session", input: "redacted" },
      },
      response: {
        provider: "debug",
        runId: "run-1",
        status: "completed",
        outputText: "Recorded fixture response",
      },
    });
    expect(raw).not.toContain("do-not-store");
    expect(raw).not.toContain("secret-token");
  });

  test("replay mode returns cassette response without calling provider", async () => {
    const cassetteDir = await tempCassetteDir();
    await withProviderResponseFixture(request(), async () => response({ outputText: "Replay me" }), {
      cassetteDir,
      feature: "chat",
      mode: "record",
      name: "replayable",
      provider: "debug",
    });

    const snapshot = await withProviderResponseFixture(request(), async () => {
      throw new Error("provider should not run during replay");
    }, {
      cassetteDir,
      feature: "chat",
      mode: "replay",
      name: "replayable",
      provider: "debug",
    });

    expect(snapshot.outputText).toBe("Replay me");
  });
});
