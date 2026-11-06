import { expect, test } from "bun:test";
import { editorRequestSchema } from "./execution";
import { WORK_PROTOCOL, WORK_HTTP, workCleanupInputSchema, workRequestSchema, workStartSchema, executionSourceSchema, parseWorkResponse, workViewSchema } from "./execution-v2";
import fixture from "../../fixtures/executions-v2/cases.json";

test("shared v2 fixtures correlate all thirteen operations on the commands route", () => {
  expect(fixture.requests).toHaveLength(13);
  expect(WORK_HTTP).toEqual({ method: "POST", commands: "/api/editor/v1/commands" });
  for (const [index, body] of fixture.requests.entries()) {
    const request = workRequestSchema.parse(body), response = fixture.responses[index]!;
    expect(parseWorkResponse(request, response).ok).toBe(true);
    expect(() => parseWorkResponse(request, { ...response, requestId: "other-request" })).toThrow();
  }
  const snapshot = workRequestSchema.parse(fixture.requests.find(item => item.command.op === "snapshot"));
  const raw = fixture.responses.find(item => item.requestId === snapshot.requestId)!;
  expect(() => parseWorkResponse(snapshot, { ...raw, data: { ...raw.data, runId: "other-run" } })).toThrow();
  const get = workRequestSchema.parse(fixture.requests[1]);
  expect(() => parseWorkResponse(get, { v: WORK_PROTOCOL, requestId: get.requestId, ok: true, data: { accepted: true } })).toThrow();
});

test("group registration freezes unique children and an acyclic dependency graph", () => {
  expect(workStartSchema.safeParse(fixture.group).success).toBe(true);
  const [first, second] = fixture.group.children;
  for (const children of [
    [first, first], [first, { ...second, commandKey: first!.commandKey }],
    [{ ...first, dependsOnWorkIds: [second!.workId] }, second],
    [first, { ...second, dependsOnWorkIds: ["foreign-work"] }],
    [first, { ...second, dependsOnWorkIds: [first!.workId, first!.workId] }],
  ]) expect(workStartSchema.safeParse({ ...fixture.group, children }).success).toBe(false);
  expect(workStartSchema.safeParse({ ...first, parentWorkId: "existing-parent" }).success).toBe(false);
  const view = fixture.responses[0]!.data;
  expect(workViewSchema.safeParse({ ...view, kind: "group" }).success).toBe(false);
  expect(workViewSchema.safeParse({ ...view, execution: { ...(view as { execution: object }).execution, workId: "foreign-work" } }).success).toBe(false);
});

const leaf = { kind: "execution", workId: "work", commandKey: "key", goal: "Inspect the selected source", budget: { timeoutMs: 1000, maxToolCalls: 1 }, placement: { executorId: "device", projectRef: "project", mappingRevision: 1 }, workspace: { mode: "independent_worktree", baseline: { kind: "commit", digest: "a".repeat(40) } }, queueExpiresAt: "2026-11-06T00:00:00Z" };
test("v2 fixed placement and groups require the explicit version and bounded body", () => {
  const body = { v: WORK_PROTOCOL, requestId: "request", command: { op: "start", input: leaf } };
  expect(workRequestSchema.parse(body).command.op).toBe("start");
  expect(editorRequestSchema.safeParse(body).success).toBe(false);
  expect(workStartSchema.parse({ kind: "group", workId: "parent", commandKey: "parent-key", goal: "Compare independent results", children: [leaf] }).kind).toBe("group");
  expect(workStartSchema.safeParse({ ...leaf, workspace: { mode: "independent_worktree", baseline: { kind: "snapshot", digest: "opaque" } } }).success).toBe(false);
  const children = Array.from({ length: 20 }, (_, i) => ({ ...leaf, workId: `child-${i}`, commandKey: `key-${i}`, goal: "x".repeat(20_000) }));
  expect(workRequestSchema.safeParse({ ...body, command: { op: "start", input: { kind: "group", workId: "parent", commandKey: "group-key", goal: "large", children } } }).success).toBe(false);
});
test("source manifests bind raw byte digests without authorizing paths or duplicate files", () => {
  const entry = { path: "src/main.ts", sha256: "b".repeat(64) };
  expect(executionSourceSchema.safeParse({ files: [entry] }).success).toBe(true);
  for (const path of ["../private", "/private", "src/../private", "C:\\private", "src//private"]) expect(executionSourceSchema.safeParse({ files: [{ ...entry, path }] }).success).toBe(false);
  expect(executionSourceSchema.safeParse({ files: [entry, entry] }).success).toBe(false);
});
test("cleanup confirmation and v2 cancel require the exact review and execution identities", () => {
  expect(workCleanupInputSchema.safeParse({ workId: "work", commandKey: "key", action: "confirm" }).success).toBe(false);
  expect(workCleanupInputSchema.safeParse({ workId: "work", commandKey: "key", action: "preview" }).success).toBe(true);
  const body = { v: WORK_PROTOCOL, requestId: "request", command: { op: "cancel", workId: "work", commandKey: "key", runId: "run" } };
  expect(workRequestSchema.safeParse(body).success).toBe(false);
  expect(workRequestSchema.safeParse({ ...body, command: { ...body.command, attemptId: "attempt" } }).success).toBe(true);
});
