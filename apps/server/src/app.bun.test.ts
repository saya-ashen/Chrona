import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { mintRunToken, revokeRunToken } from "@chrona/engine";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

import { resetTestDb, seedTask, seedWorkspace } from "./__tests__/bun-test-helpers";
import { createServerApp } from "./app";
import { resetEnvCacheForTests } from "./config/env";

function mcpInitializeBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "app-auth-test", version: "1.0.0" },
    },
  });
}

function resetEnv() {
  delete process.env.API_KEY;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.CHRONA_UNSAFE_CORS;
  delete process.env.CHRONA_CONFIG_FILE;
  delete process.env.CHRONA_WEB_DIST;
  resetEnvCacheForTests();
}

describe("server API origin policy", () => {
  beforeEach(() => {
    resetEnv();
    process.env.ALLOWED_ORIGINS = "https://trusted.example";
    resetEnvCacheForTests();
  });

  afterEach(resetEnv);

  it("rejects untrusted preflight and mutation requests before they reach API routes", async () => {
    const app = await createServerApp();
    const headers = {
      Origin: "https://attacker.example",
      "Access-Control-Request-Method": "POST",
    };

    const preflight = await app.request("http://local/api/ai/clients", {
      method: "OPTIONS",
      headers,
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();

    const mutation = await app.request("http://local/api/ai/clients", {
      method: "POST",
      headers: { Origin: headers.Origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "must-not-create", type: "hermes" }),
    });
    expect(mutation.status).toBe(403);
    expect(mutation.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows configured-origin preflight and does not treat an API mutation as cross-origin", async () => {
    const app = await createServerApp();

    const preflight = await app.request("http://local/api/ai/clients", {
      method: "OPTIONS",
      headers: {
        Origin: "https://trusted.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://trusted.example");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("vary")).toBe("Origin");

    const sameOriginMutation = await app.request("http://local/api/ai/clients", {
      method: "POST",
      headers: { Origin: "http://local", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(sameOriginMutation.status).toBe(400);
    expect(sameOriginMutation.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("server API key and run-token authentication", () => {
  beforeEach(async () => {
    resetEnv();
    process.env.API_KEY = "app-test-api-key";
    resetEnvCacheForTests();
    await resetTestDb();
  });

  afterEach(async () => {
    resetEnv();
    await resetTestDb();
  });

  it("keeps ordinary APIs behind API_KEY while delegating only agent control to its run-token contract", async () => {
    const { workspaceId } = await seedWorkspace("App authentication");
    const { taskId } = await seedTask(workspaceId, { status: "Running" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "omp",
        runtimeSessionRef: "app-auth-session",
        status: "Running",
        triggeredBy: "agent",
      },
    });
    const plan = await db.taskPlan.create({
      data: {
        workspaceId,
        taskId,
        planId: "app-auth-plan",
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    const planRun = await db.taskPlanRun.create({
      data: {
        workspaceId,
        taskId,
        planId: plan.planId,
        planRun: {},
      },
    });
    const attempt = await db.taskPlanNodeAttempt.create({
      data: {
        workspaceId,
        taskId,
        planId: plan.planId,
        planRunId: planRun.id,
        nodeId: "node-1",
        nodeLayerId: "layer-1",
        idempotencyKey: "app-auth-attempt",
        attemptNumber: 1,
        status: "running",
        executionEpoch: 0,
      },
    });
    const runToken = await mintRunToken({
      taskId,
      workspaceId,
      runId: run.id,
      runtimeSessionKey: "app-auth-session",
      nodeId: attempt.nodeId,
      nodeAttemptId: attempt.id,
    });
    const secondRunToken = await mintRunToken({
      taskId,
      workspaceId,
      runId: run.id,
      runtimeSessionKey: "app-auth-session",
      nodeId: attempt.nodeId,
      nodeAttemptId: attempt.id,
    });
    const app = await createServerApp();

    expect((await app.request("http://local/api/workspaces/default")).status).toBe(401);
    expect((await app.request("http://local/api/workspaces/default", {
      headers: { Authorization: "Bearer wrong-api-key" },
    })).status).toBe(401);
    expect((await app.request("http://local/api/workspaces/default", {
      headers: { Authorization: "Bearer app-test-api-key" },
    })).status).toBe(200);
    expect((await app.request("http://local/api/workspaces/default", {
      headers: { Authorization: `Bearer ${runToken}` },
    })).status).toBe(401);
    const mcpHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    expect((await app.request("http://local/api/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: mcpInitializeBody(),
    })).status).toBe(401);
    expect((await app.request("http://local/api/mcp", {
      method: "POST",
      headers: { ...mcpHeaders, authorization: "Bearer invalid-run-token" },
      body: mcpInitializeBody(),
    })).status).toBe(401);

    expect((await app.request(
      "http://local/api/mcp?session_id=wrong-session",
      {
        method: "POST",
        headers: { ...mcpHeaders, authorization: `Bearer ${runToken}` },
        body: mcpInitializeBody(),
      },
    )).status).toBe(401);
    const runTokenInit = await app.request(
      "http://local/api/mcp?session_id=app-auth-session&terminal_only=1",
      {
        method: "POST",
        headers: { ...mcpHeaders, authorization: `Bearer ${runToken}` },
        body: mcpInitializeBody(),
      },
    );
    expect(runTokenInit.status).toBe(200);
    const runTokenMcpSession = runTokenInit.headers.get("mcp-session-id");
    expect(runTokenMcpSession).toBeTruthy();
    const runToolRequest = await app.request(
      "http://local/api/mcp?session_id=app-auth-session",
      {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${runToken}`,
          ...(runTokenMcpSession ? { "mcp-session-id": runTokenMcpSession } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "chrona_feature_complete", arguments: { result: {} } },
        }),
      },
    );
    expect(runToolRequest.status).toBe(200);
    expect((await app.request("http://local/api/mcp?session_id=app-auth-session", {
      method: "POST",
      headers: {
        ...mcpHeaders,
        authorization: "Bearer app-test-api-key",
        ...(runTokenMcpSession ? { "mcp-session-id": runTokenMcpSession } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    })).status).toBe(401);
    expect((await app.request("http://local/api/mcp?session_id=app-auth-session", {
      method: "POST",
      headers: {
        ...mcpHeaders,
        authorization: `Bearer ${secondRunToken}`,
        ...(runTokenMcpSession ? { "mcp-session-id": runTokenMcpSession } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }),
    })).status).toBe(401);
    const apiKeyInit = await app.request("http://local/api/mcp", {
      method: "POST",
      headers: { ...mcpHeaders, authorization: "Bearer app-test-api-key" },
      body: mcpInitializeBody(),
    });
    expect(apiKeyInit.status).toBe(200);
    const apiKeyMcpSession = apiKeyInit.headers.get("mcp-session-id");
    expect((await app.request("http://local/api/mcp?session_id=app-auth-session", {
      method: "POST",
      headers: {
        ...mcpHeaders,
        authorization: `Bearer ${runToken}`,
        ...(apiKeyMcpSession ? { "mcp-session-id": apiKeyMcpSession } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} }),
    })).status).toBe(401);
    expect((await app.request("http://local/api/agent/control")).status).toBe(401);

    const missingRunToken = await app.request("http://local/api/agent/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: { kind: "complete", payload: { summary: "Done" } } }),
    });
    expect(missingRunToken.status).toBe(401);

    const globalApiKeyAtAgentControl = await app.request("http://local/api/agent/control", {
      method: "POST",
      headers: {
        authorization: "Bearer app-test-api-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: { kind: "complete", payload: { summary: "Done" } } }),
    });
    expect(globalApiKeyAtAgentControl.status).toBe(401);

    const invalidRunToken = await app.request("http://local/api/agent/control", {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-run-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: { kind: "complete", payload: { summary: "Done" } } }),
    });
    expect(invalidRunToken.status).toBe(401);

    const validRunToken = await app.request("http://local/api/agent/control", {
      method: "POST",
      headers: {
        authorization: `Bearer ${runToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: { kind: "complete", payload: { summary: "Done" } } }),
    });
    expect(validRunToken.status).toBe(200);
    expect(await validRunToken.json()).toMatchObject({
      ok: true,
      kind: "complete",
      recorded: true,
    });
    await revokeRunToken(runToken);
    expect((await app.request("http://local/api/mcp?session_id=app-auth-session", {
      method: "POST",
      headers: {
        ...mcpHeaders,
        authorization: `Bearer ${runToken}`,
        ...(runTokenMcpSession ? { "mcp-session-id": runTokenMcpSession } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} }),
    })).status).toBe(401);
    expect((await app.request("http://local/api/mcp?session_id=app-auth-session", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${runToken}`,
        ...(runTokenMcpSession ? { "mcp-session-id": runTokenMcpSession } : {}),
      },
    })).status).toBe(204);
    expect((await app.request("http://local/api/mcp?session_id=app-auth-session", {
      method: "POST",
      headers: { ...mcpHeaders, authorization: `Bearer ${runToken}` },
      body: mcpInitializeBody(),
    })).status).toBe(401);
  });

  it("keeps local MCP compatibility without API_KEY while rejecting invalid bearer credentials", async () => {
    resetEnv();
    await resetTestDb();
    const app = await createServerApp();
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    expect((await app.request("http://local/api/mcp", {
      method: "POST",
      headers,
      body: mcpInitializeBody(),
    })).status).toBe(200);
    expect((await app.request("http://local/api/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer invalid-run-token" },
      body: mcpInitializeBody(),
    })).status).toBe(401);
  });
});
