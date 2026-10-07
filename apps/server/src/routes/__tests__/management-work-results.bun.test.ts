import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { readWorkResultSchema, resultFileSchema } from "@chrona/contracts/results";
import { createChronaEngine, createManagementClient, revokeManagementClient } from "@chrona/engine";
import { db, resetTestDb, seedTask } from "@chrona/db";
import { createManagementMcpRoutes } from "../../../../../features/mcp-control-plane/server";

const prior = process.env.CHRONA_RESULT_WRITES_ENABLED;
const app = new Hono().route("/api", createManagementMcpRoutes(createChronaEngine()));
beforeEach(async () => { await resetTestDb(); process.env.CHRONA_RESULT_WRITES_ENABLED = "true"; });
afterEach(async () => { await resetTestDb(); if (prior === undefined) delete process.env.CHRONA_RESULT_WRITES_ENABLED; else process.env.CHRONA_RESULT_WRITES_ENABLED = prior; });
async function request(token: string, method: string, params: unknown) {
  const response = await app.request("http://localhost/api/mcp/management", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { status: response.status, body: await response.json() };
}
const call = (token: string, name: string, args: unknown) => request(token, "tools/call", { name, arguments: args });
const content = { schemaVersion: 1, outcome: { title: "Text result", summary: "Recorded without a provider" }, readiness: { status: "ready", summary: "Ready for review" } };

it("transfers scoped chunks through MCP, shares owner HTTP storage semantics and denies legacy/text credentials", async () => {
  const writer = await createManagementClient({ name: "Files", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "results:read", "results:write", "artifacts:read", "artifacts:write"] });
  const textOnly = await createManagementClient({ name: "Text", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "results:read", "results:write"] });
  const identity = await createChronaEngine().management.authorize(writer.token), { taskId } = await seedTask(identity.workspaceId);
  const bytes = Buffer.alloc(32768, "x"), sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const args = { taskId, action: { type: "begin", requestId: crypto.randomUUID(), filename: "file.bin", mimeType: "application/octet-stream", sizeBytes: bytes.length, sha256 } };
  const tools = ListToolsResultSchema.parse((await request(writer.token, "tools/list", {})).body.result).tools;
  const validator = new AjvJsonSchemaValidator().getValidator(tools.find((t) => t.name === "chrona_result_file")!.inputSchema as JsonSchemaType);
  for (const value of [args, { ...args, actorKey: "spoof" }, { taskId, action: { type: "read", artifactRef: "AF000000000000" } }, { ...args, action: { ...args.action, path: "/etc/passwd" } }]) {
    expect(validator(value).valid).toBe(resultFileSchema.safeParse(value).success);
  }
  expect((await call(textOnly.token, "chrona_result_file", args)).body.result.structuredContent.error.code).toBe("FORBIDDEN");
  const begun = (await call(writer.token, "chrona_result_file", args)).body.result.structuredContent.data;
  const chunk = { taskId, action: { type: "write", uploadId: begun.uploadId, offset: 0, sha256, base64: bytes.toString("base64") } };
  expect((await call(writer.token, "chrona_result_file", chunk)).body.result.structuredContent.data.receivedBytes).toBe(bytes.length);
  const finished = (await call(writer.token, "chrona_result_file", { taskId, action: { type: "finish", uploadId: begun.uploadId } })).body.result.structuredContent.data;
  const published = (await call(writer.token, "chrona_result_submit", { taskId, requestId: crypto.randomUUID(), expectedRevision: finished.editRevision,
    content: { ...content, deliverables: [{ key: "file", title: "File", kind: "other", artifactRef: finished.artifactRef }] } })).body.result.structuredContent.data;
  const readArgs = { taskId, action: { type: "read", versionId: published.receipt.versionId, artifactRef: finished.artifactRef } };
  expect((await call(writer.token, "chrona_result_file", readArgs)).body.result.structuredContent.data.base64).toBe(bytes.toString("base64"));
  expect((await call(textOnly.token, "chrona_result_file", readArgs)).body.result.structuredContent.error.code).toBe("FORBIDDEN");
  await revokeManagementClient(writer.clientId);
  expect((await call(writer.token, "chrona_result_file", args)).status).toBe(401);
  expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.managementCommand.count()])).toEqual([0, 0, 0]);
});

describe("independent result MCP protocol", () => {
  it("advertises strict object-root tools, independent permissions and selector parity", async () => {
    const client = await createManagementClient({ name: "Schema", publicUrl: "http://localhost:3101" });
    const tools = ListToolsResultSchema.parse((await request(client.token, "tools/list", {})).body.result).tools;
    for (const name of ["chrona_result_read", "chrona_result_submit", "chrona_result_review", "chrona_result_file"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations?.readOnlyHint).toBe(name === "chrona_result_read");
    }
    expect(tools.some((t) => t.name === "chrona_result_file")).toBe(true);
    const read = tools.find((t) => t.name === "chrona_result_read")!;
    const validate = new AjvJsonSchemaValidator().getValidator(read.inputSchema as JsonSchemaType);
    for (const selection of [undefined, "latest", "accepted", "version"]) {
      for (const view of [undefined, "content", "versions", "reviews"]) {
        for (const versionId of [undefined, "v1"]) {
          const value = JSON.parse(JSON.stringify({ taskId: "t1", selection, view, versionId }));
          expect({ value, valid: validate(value).valid }).toEqual({ value, valid: readWorkResultSchema.safeParse(value).success });
        }
      }
    }
    const submit = tools.find((t) => t.name === "chrona_result_submit")!;
    const validateSubmit = new AjvJsonSchemaValidator().getValidator(submit.inputSchema as JsonSchemaType);
    const value = { taskId: "t1", requestId: crypto.randomUUID(), expectedRevision: null, content };
    expect(validateSubmit(value).valid).toBe(true);
    for (const extra of [{ actorId: "human" }, { runId: "fake" }, { workspaceId: "foreign" }, { status: "Completed" }, { source: { actorKind: "human" } }]) expect(validateSubmit({ ...value, ...extra }).valid).toBe(false);
    expect(submit.description).toContain("results:write");
    expect(tools.find((t) => t.name === "chrona_result_review")!.description).toContain("independent results:review");
  });

  it("accepts bounded 64–96 KiB result arguments through the SDK and rejects oversized transport bodies", async () => {
    const writer = await createManagementClient({ name: "Budget", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "results:read", "results:write"] });
    const identity = await createChronaEngine().management.authorize(writer.token);
    const { taskId } = await seedTask(identity.workspaceId);
    const findings = Array.from({ length: 12 }, (_, i) => ({ key: `f${i}`, content: "x".repeat(6_000) }));
    const args = { taskId, requestId: crypto.randomUUID(), expectedRevision: null, content: { ...content, findings } };
    expect((await call(writer.token, "chrona_result_submit", args)).body.result.isError).toBe(false);
    const read = await call(writer.token, "chrona_result_read", { taskId });
    expect(read.body.result.structuredContent.data.version.content.findings).toHaveLength(12);
    expect(Buffer.byteLength(JSON.stringify(read.body.result.structuredContent))).toBeLessThan(128 * 1024);
    const tooLarge = await call(writer.token, "chrona_result_submit", { ...args, padding: "x".repeat(120 * 1024) });
    expect(tooLarge.status).toBe(413);
    expect(JSON.stringify(tooLarge.body).length).toBeLessThan(200);
    expect(await db.resultCommand.count()).toBe(1);
  });

  it("publishes/replays/reads via real tools/call without granting review, execution or legacy-token access", async () => {
    const writer = await createManagementClient({ name: "Writer", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "results:read", "results:write"] });
    const reviewer = await createManagementClient({ name: "Reviewer", publicUrl: "http://localhost:3101", scopes: ["tasks:read", "results:read", "results:review"] });
    const legacy = await createManagementClient({ name: "Legacy", publicUrl: "http://localhost:3101" });
    const identity = await createChronaEngine().management.authorize(writer.token);
    const { taskId } = await seedTask(identity.workspaceId);
    const args = { taskId, requestId: crypto.randomUUID(), expectedRevision: null, content };
    const submitted = await call(writer.token, "chrona_result_submit", args);
    expect(submitted.body.result.isError).toBe(false);
    const receipt = submitted.body.result.structuredContent.data.receipt;
    expect((await call(writer.token, "chrona_result_submit", args)).body.result.structuredContent.data).toEqual({ replayed: true, receipt });
    const read = await call(writer.token, "chrona_result_read", { taskId });
    expect(read.body.result.structuredContent.data.version.actorKey).toBe(`external:${writer.clientId}`);
    const review = { taskId, requestId: crypto.randomUUID(), versionId: receipt.versionId, expectedRevision: receipt.editRevision, decision: "accept" };
    expect((await call(writer.token, "chrona_result_review", review)).body.result.structuredContent.error.code).toBe("FORBIDDEN");
    expect((await call(reviewer.token, "chrona_result_review", review)).body.result.structuredContent.data.receipt.acceptedVersionId).toBe(receipt.versionId);
    expect((await call(legacy.token, "chrona_result_read", { taskId })).body.result.structuredContent.error.code).toBe("FORBIDDEN");
    expect((await call(writer.token, "chrona_result_submit", { ...args, actorId: "spoof" })).body.result.isError).toBe(true);
    expect(await db.managementCommand.count()).toBe(0);
    expect(await db.resultCommand.count()).toBe(2);
    expect(await db.run.count()).toBe(0);
    await revokeManagementClient(writer.clientId);
    expect((await call(writer.token, "chrona_result_submit", args)).status).toBe(401);
  });
});
