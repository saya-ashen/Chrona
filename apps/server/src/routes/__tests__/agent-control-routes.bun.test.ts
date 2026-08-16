import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { mintRunToken, revokeRunToken } from "@chrona/engine";
import { resetTestDb, seedTask, seedWorkspace } from "../../__tests__/bun-test-helpers";
import { createAgentControlRoutes } from "../../../../../features/mcp-control-plane/routes/agent-control.routes";

const body = JSON.stringify({ body: { kind: "task_read", payload: {} } });

function request(app: ReturnType<typeof createAgentControlRoutes>, token?: string) {
  return app.request("/agent/control", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

describe("agent control run-token authorization", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("rejects missing, wrong, and revoked tokens without changing execution state", async () => {
    const { workspaceId } = await seedWorkspace("Agent control auth");
    const { taskId } = await seedTask(workspaceId, { status: "Running" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        runtimeSessionRef: "agent-control-session",
        status: "Running",
        triggeredBy: "agent",
      },
    });
    const execution = await db.executionSession.create({
      data: {
        workspaceId,
        taskId,
        status: "Active",
        currentNodeId: "node-current",
        startedAt: new Date(),
      },
    });
    const token = await mintRunToken({
      taskId,
      workspaceId,
      runId: run.id,
      runtimeSessionKey: "agent-control-session",
      nodeAttemptId: "attempt-current",
    });
    const app = createAgentControlRoutes();

    expect((await request(app)).status).toBe(401);
    expect((await request(app, "wrong-run-token")).status).toBe(401);
    expect(await revokeRunToken(token)).toBe(true);
    expect((await request(app, token)).status).toBe(401);

    const retainedRun = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    const retainedExecution = await db.executionSession.findUniqueOrThrow({ where: { id: execution.id } });
    expect(retainedRun.status).toBe(run.status);
    expect(retainedRun.taskId).toBe(taskId);
    expect(retainedExecution.status).toBe(execution.status);
    expect(retainedExecution.currentNodeId).toBe("node-current");
    expect(retainedExecution.taskId).toBe(taskId);
  });
});
