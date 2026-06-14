import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildControlPayload } from "./payloads";
import { run } from "./main";

const tempRoot = join(tmpdir(), `chrona-agent-cli-${process.pid}`);

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function jsonFile(name: string, value: unknown) {
  mkdirSync(tempRoot, { recursive: true });
  const path = join(tempRoot, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("buildControlPayload", () => {
  it("maps node output argv to control payload", () => {
    const output = { root: "card", elements: { card: { type: "Card" } } };
    const path = jsonFile("output.json", output);

    expect(buildControlPayload(["node", "output", "--outputs-file", path, "--mode", "replace", "--summary", "partial"]).body).toEqual({
      kind: "output",
      payload: { outputs: [output], mode: "replace", summary: "partial" },
    });
  });

  it("maps terminal node commands to payloads", () => {
    const form = { instructions: "Need key", inputFields: [{ name: "key", label: "Key" }] };

    expect(buildControlPayload(["node", "complete", "--summary", "done"]).body).toEqual({
      kind: "complete",
      payload: { summary: "done" },
    });
    expect(buildControlPayload(["node", "condition-select", "--branch", "B1", "--summary", "yes"]).body).toEqual({
      kind: "condition_select",
      payload: { nodeId: "current", branchRef: "B1", summary: "yes" },
    });
    expect(buildControlPayload(["node", "wait-complete", "--summary", "observed"]).body).toEqual({
      kind: "wait_complete",
      payload: { summary: "observed" },
    });
    expect(buildControlPayload(["node", "block", "--reason", "Need key", "--action-form", JSON.stringify(form)]).body).toEqual({
      kind: "block",
      payload: { reason: "Need key", actionForm: form },
    });
    expect(buildControlPayload(["node", "fail", "--error", "boom", "--diagnostics", "{\"exitCode\":1}"]).body).toEqual({
      kind: "fail",
      payload: { error: "boom", diagnostics: { exitCode: 1 } },
    });
  });

  it("maps read commands without IDs", () => {
    expect(buildControlPayload(["task", "read"]).body).toEqual({ kind: "task_read", payload: {} });
    expect(buildControlPayload(["plan", "read"]).body).toEqual({ kind: "plan_read", payload: {} });
  });
});

const unreachableFetch = async (): Promise<Response> => {
  throw new Error("fetch should not run");
};

describe("run", () => {
  it("returns non-zero when required env is missing", async () => {
    let stderr = "";
    const code = await run({
      argv: ["node", "fail", "--error", "boom"],
      env: {},
      fetchImpl: unreachableFetch,
      stdout: { write: () => true },
      stderr: { write: (chunk: string | Uint8Array) => { stderr += String(chunk); return true; } },
    });

    expect(code).toBe(1);
    expect(stderr).toContain("CHRONA_BASE_URL");
    expect(stderr).toContain("CHRONA_RUN_TOKEN");
  });

  it("posts expected request shape to /agent/control", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let stdout = "";
    const code = await run({
      argv: ["node", "fail", "--error", "boom"],
      env: { CHRONA_BASE_URL: "http://127.0.0.1:3101/", CHRONA_RUN_TOKEN: "run-token" },
      fetchImpl: (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      },
      stdout: { write: (chunk: string | Uint8Array) => { stdout += String(chunk); return true; } },
      stderr: { write: () => true },
    });

    expect(code).toBe(0);
    expect(stdout).toContain("{\"ok\":true}");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:3101/agent/control");
    expect(requests[0].init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer run-token",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      kind: "fail",
      payload: { error: "boom" },
    });
  });
});
