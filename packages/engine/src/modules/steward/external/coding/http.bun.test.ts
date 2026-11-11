import { describe, expect, mock, test } from "bun:test";
import { CODING_HTTP_COMMANDS_PATH, CODING_HTTP_MAX_BODY_BYTES, handleCodingHttp } from "./http";

const origin = "http://coding.test";
function post(body: BodyInit = '{"op":"projects.list"}', headers: HeadersInit = { "Content-Type": "application/json" }): Request {
  return new Request(origin + CODING_HTTP_COMMANDS_PATH, { method: "POST", headers, body });
}
async function expectFailure(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("application/json;charset=utf-8");
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["error"]);
  expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
}
function stream(chunks: Uint8Array[], cancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]!);
      else controller.close();
    },
    cancel,
  });
}

// Minimal transport fixture: business strictness is deliberately in dispatch,
// never duplicated in the HTTP adapter. It models the documented list command.
function strictListDispatch(raw: unknown): Promise<unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)
    || Object.keys(raw).length !== 1 || !("op" in raw) || raw.op !== "projects.list") {
    return Promise.reject(Object.assign(new Error("Invalid Coding command"), { code: "invalid" }));
  }
  return Promise.resolve({ projects: [], defaultProjectRef: null });
}

describe("Coding common HTTP transport", () => {
  test("dispatches the common command unchanged and wraps the result once", async () => {
    const command = { op: "conversations.create", requestKey: "create-1", projectRef: "project-1", title: "测试" };
    const result = { receipt: { requestKey: "create-1", status: "accepted", value: { id: "conversation-1" } } };
    const dispatch = mock(async (_raw: unknown) => result);
    const response = await handleCodingHttp(post(JSON.stringify(command)), dispatch);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json;charset=utf-8");
    expect(await response.json()).toEqual({ result });
    expect(dispatch.mock.calls).toEqual([[command]]);
  });

  for (const result of [null, false, 0, "", [], { error: { code: "conflict", message: "This is result data" } }]) {
    test(`preserves JSON result ${JSON.stringify(result)}`, async () => {
      const response = await handleCodingHttp(post(), async () => result);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result });
    });
  }

  for (const contentType of ["application/json", "Application/JSON", "application/json; charset=utf-8", 'application/json; charset="UTF-8"']) {
    test(`accepts JSON content type ${contentType}`, async () => {
      expect((await handleCodingHttp(post(undefined, { "content-type": contentType }), strictListDispatch)).status).toBe(200);
    });
  }
  for (const contentType of [null, "text/plain", "application/jsonp", "application/problem+json", "application/json, text/plain", "application/json; charset=utf-16", "application/json; charset=utf-8; charset=utf-16"]) {
    test(`rejects content type ${contentType} before dispatch`, async () => {
      const dispatch = mock(strictListDispatch);
      await expectFailure(await handleCodingHttp(post("{}", contentType ? { "content-type": contentType } : {}), dispatch), 415, "unsupported_media_type");
      expect(dispatch).not.toHaveBeenCalled();
    });
  }
  test("rejects compressed bodies and accepts explicit identity encoding", async () => {
    const dispatch = mock(strictListDispatch);
    await expectFailure(await handleCodingHttp(post("{}", { "content-type": "application/json", "content-encoding": "gzip" }), dispatch), 415, "unsupported_media_type");
    expect(dispatch).not.toHaveBeenCalled();
    expect((await handleCodingHttp(post(undefined, { "content-type": "application/json", "content-encoding": "identity" }), dispatch)).status).toBe(200);
  });

  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    test(`returns 405 and Allow for ${method} without dispatch`, async () => {
      const dispatch = mock(strictListDispatch);
      const response = await handleCodingHttp(new Request(origin + CODING_HTTP_COMMANDS_PATH, { method }), dispatch);
      await expectFailure(response, 405, "method_not_allowed");
      expect(response.headers.get("allow")).toBe("POST");
      expect(dispatch).not.toHaveBeenCalled();
    });
  }
  for (const path of ["/api/coding", "/api/coding/v1/commands/", "/api/coding/v1/events", "/api/coding/v2/commands", "/api/coding/v1/agent.work-run"]) {
    test(`does not expose compatibility or arbitrary routes at ${path}`, async () => {
      const dispatch = mock(strictListDispatch);
      await expectFailure(await handleCodingHttp(new Request(origin + path), dispatch), 404, "not_found");
      expect(dispatch).not.toHaveBeenCalled();
    });
  }

  for (const text of ["", " ", "{", '{"op":"projects.list",}', "{}{}", '{"x":NaN}', "// comment\n{}", '{"text":"\u0001"}']) {
    test(`rejects invalid JSON ${JSON.stringify(text)}`, async () => {
      const dispatch = mock(strictListDispatch);
      await expectFailure(await handleCodingHttp(post(text), dispatch), 400, "invalid");
      expect(dispatch).not.toHaveBeenCalled();
    });
  }
  test("rejects a missing body", async () => {
    const request = new Request(origin + CODING_HTTP_COMMANDS_PATH, { method: "POST", headers: { "content-type": "application/json" } });
    await expectFailure(await handleCodingHttp(request, strictListDispatch), 400, "invalid");
  });
  test("rejects malformed UTF-8 rather than replacing bytes in command text", async () => {
    const body = new Uint8Array([...new TextEncoder().encode('{"text":"'), 0xc3, 0x28, ...new TextEncoder().encode('"}')]);
    const dispatch = mock(strictListDispatch);
    await expectFailure(await handleCodingHttp(post(body), dispatch), 400, "invalid");
    expect(dispatch).not.toHaveBeenCalled();
  });
  test("accepts UTF-8 characters split across stream chunks", async () => {
    const bytes = new TextEncoder().encode('{"text":"编码🙂"}');
    const dispatch = mock(async (raw: unknown) => raw);
    const response = await handleCodingHttp(post(stream(Array.from(bytes, byte => new Uint8Array([byte])))), dispatch);
    expect(await response.json()).toEqual({ result: { text: "编码🙂" } });
  });
  test("turns body read failures into invalid without exposing internal errors", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() { throw new Error("private socket failure"); } });
    const dispatch = mock(strictListDispatch);
    const response = await handleCodingHttp(post(body), dispatch);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private socket failure");
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("accepts an exact 256 KiB frame and counts bytes instead of UTF-16 characters", async () => {
    const prefix = '{"text":"', suffix = '"}';
    const text = "界".repeat(80_000);
    const padding = " ".repeat(CODING_HTTP_MAX_BODY_BYTES - new TextEncoder().encode(prefix + text + suffix).byteLength);
    const body = prefix + text + suffix + padding;
    const dispatch = mock(async () => ({ accepted: true }));
    expect((await handleCodingHttp(post(body), dispatch)).status).toBe(200);
    expect(dispatch.mock.calls).toHaveLength(1);
    await expectFailure(await handleCodingHttp(post(body + " "), dispatch), 413, "too_large");
    expect(dispatch.mock.calls).toHaveLength(1);
  });
  test("stops reading a streamed oversized frame without trusting Content-Length", async () => {
    let cancelled = false;
    const dispatch = mock(strictListDispatch);
    const body = stream([new Uint8Array(CODING_HTTP_MAX_BODY_BYTES), new Uint8Array(1), new Uint8Array(100)], () => { cancelled = true; });
    await expectFailure(await handleCodingHttp(post(body, { "content-type": "application/json", "content-length": "1" }), dispatch), 413, "too_large");
    expect(cancelled).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
  test("rejects an advertised oversized frame before reading it", async () => {
    const dispatch = mock(strictListDispatch);
    const request = post("{}", { "content-type": "application/json", "content-length": String(CODING_HTTP_MAX_BODY_BYTES + 1) });
    await expectFailure(await handleCodingHttp(request, dispatch), 413, "too_large");
    expect(request.bodyUsed).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  for (const [code, status] of [["invalid", 400], ["forbidden", 403], ["not_found", 404], ["conflict", 409], ["capacity", 429], ["too_large", 413], ["unavailable", 503]] as const) {
    test(`preserves application ${code} as HTTP ${status} with only its public message`, async () => {
      const error = Object.assign(new Error(`Public ${code} message`), { code, cause: "private cause", internal: "private metadata" });
      const response = await handleCodingHttp(post(), async () => { throw error; });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code, message: `Public ${code} message` } });
    });
  }
  for (const error of [new Error("private stack details"), { code: "internal", message: "private failure" }, { code: "toString", message: "private failure" }, null, "private failure"]) {
    test(`sanitizes an unknown failure ${String(error)}`, async () => {
      const response = await handleCodingHttp(post(), async () => { throw error; });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "unavailable", message: "Coding service unavailable" } });
    });
  }
  test("uses a fixed fallback for a known code with no public message", async () => {
    const response = await handleCodingHttp(post(), async () => { throw { code: "conflict", stack: "private" }; });
    expect(await response.json()).toEqual({ error: { code: "conflict", message: "Coding request conflict" } });
  });
  test("sanitizes invalid dispatcher outputs as service failures", async () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const result of [undefined, 1n, cycle]) {
      await expectFailure(await handleCodingHttp(post(), async () => result), 503, "unavailable");
    }
  });

  test("module-style JSON input and HTTP dispatch identical common commands", async () => {
    // Mirrors coding.command's documented input decoding without loading SDK,
    // storage or services. Both transports inject the same business dispatcher.
    const dispatch = mock(async (raw: unknown) => ({ echoed: raw }));
    const moduleCommand = ({ input }: { input: string }) => dispatch(JSON.parse(input) as unknown);
    for (const command of [
      { op: "projects.list" },
      { op: "round.send", requestKey: "send-1", sessionId: "conversation-1", workId: null, text: "继续" },
      { op: "events", sessionId: "conversation-1", workId: "work-1", runId: "run-1", attemptId: "attempt-1", cursor: "cursor-1", limit: 50 },
    ]) {
      const input = JSON.stringify(command);
      const toolResult = await moduleCommand({ input });
      const response = await handleCodingHttp(post(input), dispatch);
      expect(await response.json()).toEqual({ result: toolResult });
      expect(dispatch.mock.calls.slice(-2)).toEqual([[command], [command]]);
    }
  });

  for (const raw of [null, [], "projects.list", 1, true, {},
    { command: { op: "projects.list" } },
    { op: "projects.list", principal: "owner" },
    { op: "projects.list", moduleId: "agent" },
    { op: "projects.list", target: "agent.work-run" },
    { op: "projects.list", clientId: "owner" },
    { op: "agent.work-run", input: {} },
  ]) {
    test(`forwards ${JSON.stringify(raw)} intact for shared strict rejection`, async () => {
      const dispatch = mock(strictListDispatch);
      await expectFailure(await handleCodingHttp(post(JSON.stringify(raw)), dispatch), 400, "invalid");
      expect(dispatch.mock.calls).toEqual([[raw]]);
    });
  }
  test("headers and query fields never change the command or inject caller identity", async () => {
    const dispatch = mock(strictListDispatch);
    const request = new Request(origin + CODING_HTTP_COMMANDS_PATH + "?target=agent.work-run&principal=owner", {
      method: "POST", headers: { "content-type": "application/json", "x-principal": "owner", authorization: "Bearer transport-test" },
      body: '{"op":"projects.list"}',
    });
    expect((await handleCodingHttp(request, dispatch)).status).toBe(200);
    expect(dispatch.mock.calls).toEqual([[{ op: "projects.list" }]]);
  });
  test("client disconnect after body admission and GET do not cancel dispatched work", async () => {
    const abort = new AbortController();
    let finish!: (result: unknown) => void;
    let started!: () => void;
    const admitted = new Promise<void>(resolve => { started = resolve; });
    const dispatch = mock((_raw: unknown) => { started(); return new Promise<unknown>(resolve => { finish = resolve; }); });
    const request = new Request(origin + CODING_HTTP_COMMANDS_PATH, {
      method: "POST", headers: { "content-type": "application/json" },
      body: '{"op":"round.send","requestKey":"send-1","sessionId":"conversation-1","workId":null,"text":"continue"}', signal: abort.signal,
    });
    const pending = handleCodingHttp(request, dispatch);
    await admitted;
    abort.abort();
    await expectFailure(await handleCodingHttp(new Request(origin + CODING_HTTP_COMMANDS_PATH), dispatch), 405, "method_not_allowed");
    await expectFailure(await handleCodingHttp(new Request(origin + "/api/coding/v1/events"), dispatch), 404, "not_found");
    expect(dispatch.mock.calls).toHaveLength(1);
    finish({ receipt: { requestKey: "send-1", status: "accepted" } });
    expect((await pending).status).toBe(200);
    expect(dispatch.mock.calls).toHaveLength(1);
  });
});
