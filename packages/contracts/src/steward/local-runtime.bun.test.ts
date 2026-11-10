import { expect, test } from "bun:test";
import { runtimeStartSchema, type RuntimeStart } from "./local-runtime";

const input: RuntimeStart = {
  operationId: "operation", runId: "run", token: "synthetic-capability", lane: "foreground",
  cwd: "/fixture/workspace", sessionDir: "/fixture/sessions", sessionId: null,
  prompt: "Fixture only", systemPrompt: "Fixture instructions", resources: "minimal", deadline: null,
};

test.each([null, "2026-11-10T05:00:00Z", "2026-11-10T13:00:00+08:00"])("runtime start preserves explicit deadline %s through JSON", deadline => {
  const request = { ...input, deadline };
  expect(runtimeStartSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
});

test.each(["", "never", 0, false, undefined])("runtime start rejects invalid or omitted deadline %s", deadline => {
  expect(runtimeStartSchema.safeParse({ ...input, deadline }).success).toBe(false);
});
