import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { expect, test, type APIRequestContext } from "@playwright/test";

const CHRONA_BASE_URL = `http://127.0.0.1:${process.env.CHRONA_E2E_API_PORT ?? "43101"}`;

type CreatedTask = {
  taskId: string;
  workspaceId: string;
};

type HermesRunRequest = {
  run_id: string;
  session_id?: string;
  instructions?: string;
  input?: string;
};

type PlanBlueprint = {
  title: string;
  goal: string;
  assumptions?: string[];
  nodes: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
};

const generatedPlan: PlanBlueprint = {
  title: "Hermes E2E planning graph",
  goal: "Turn the task into an executable plan with a review checkpoint.",
  assumptions: ["The task can be completed in one implementation pass."],
  nodes: [
    {
      id: "collect_context",
      type: "task",
      title: "Collect task context",
      executor: "user",
      mode: "manual",
      expectedOutput: "Relevant constraints are understood.",
      completionCriteria: "Task scope and dependencies are clear.",
      estimatedMinutes: 15,
    },
    {
      id: "implement_solution",
      type: "task",
      title: "Implement solution",
      executor: "ai",
      mode: "auto",
      expectedOutput: "Working implementation is ready for review.",
      completionCriteria: "Implementation satisfies the task goal.",
      estimatedMinutes: 45,
    },
    {
      id: "review_before_done",
      type: "checkpoint",
      title: "Review before done",
      checkpointType: "approve",
      prompt: "Confirm the generated plan is safe to execute.",
      required: true,
    },
    {
      id: "deliver_result",
      type: "task",
      title: "Deliver result",
      executor: "ai",
      mode: "auto",
      expectedOutput: "Reviewed implementation is delivered.",
      completionCriteria: "Task result is ready after review.",
      estimatedMinutes: 10,
    },
  ],
  edges: [
    { from: "collect_context", to: "implement_solution" },
    { from: "implement_solution", to: "review_before_done" },
    { from: "review_before_done", to: "deliver_result" },
  ],
};

function readJsonBody(req: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) as Record<string, unknown> : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function writeHermesEvent(res: ServerResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function callChronaPlanGenerate(sessionId: string, blueprint: PlanBlueprint) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const initializeResponse = await fetch(`${CHRONA_BASE_URL}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "chrona-e2e-hermes", version: "1.0.0" },
      },
    }),
  });
  if (!initializeResponse.ok) {
    throw new Error(`chrona MCP initialize failed: HTTP ${initializeResponse.status}`);
  }
  const mcpSessionId = initializeResponse.headers.get("mcp-session-id");

  const response = await fetch(`${CHRONA_BASE_URL}/api/mcp`, {
    method: "POST",
    headers: {
      ...headers,
      ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "chrona_plan_generate",
        arguments: { ...blueprint, sessionId },
        _meta: {
          sessionId,
          requestId: `e2e-hermes-plan-${Date.now()}`,
        },
      },
    }),
  });

  const payload = await response.json() as { error?: { message?: string }; result?: unknown };
  if (!response.ok || payload.error) {
    throw new Error(`chrona_plan_generate failed: ${payload.error?.message ?? `HTTP ${response.status}`}`);
  }
}

async function startMockHermesServer() {
  const runs: HermesRunRequest[] = [];
  let nextRunId = 1;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    try {
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
        writeJson(res, 200, { ok: true, status: "ok" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/capabilities") {
        writeJson(res, 200, {
          features: {
            run_submission: true,
            run_events_sse: true,
            run_status: true,
            run_stop: true,
          },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/runs") {
        const body = await readJsonBody(req);
        const runId = `run-${nextRunId++}`;
        runs.push({
          run_id: runId,
          session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          instructions: typeof body.instructions === "string" ? body.instructions : undefined,
          input: typeof body.input === "string" ? body.input : undefined,
        });
        writeJson(res, 200, { run_id: runId, status: "running", session_id: body.session_id });
        return;
      }

      const streamMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
      if (req.method === "GET" && streamMatch) {
        const runId = decodeURIComponent(streamMatch[1] ?? "");
        const run = runs.find((entry) => entry.run_id === runId);
        if (!run?.session_id) {
          writeJson(res, 404, { error: "run not found" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        writeHermesEvent(res, {
          type: "message.delta",
          delta: "Creating a structured Chrona plan.",
        });
        writeHermesEvent(res, {
          type: "tool.started",
          tool: "chrona_plan_generate",
          input: generatedPlan,
          preview: "Persist generated plan graph",
        });

        try {
          await callChronaPlanGenerate(run.session_id, generatedPlan);
          writeHermesEvent(res, {
            type: "tool.completed",
            tool: "chrona_plan_generate",
          });
          writeHermesEvent(res, {
            type: "run.completed",
            session_id: run.session_id,
            output: "Plan graph persisted through Chrona MCP.",
          });
        } catch (error) {
          writeHermesEvent(res, {
            type: "tool.completed",
            tool: "chrona_plan_generate",
            error: error instanceof Error ? error.message : String(error),
          });
          writeHermesEvent(res, {
            type: "run.failed",
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          res.end();
        }
        return;
      }

      writeJson(res, 404, { error: `No mock Hermes route for ${req.method} ${url.pathname}` });
    } catch (error) {
      writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind mock Hermes server");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    runs,
    stop: () => {
      server.close();
      server.unref();
    },
  };
}

async function createHermesPlanClient(request: APIRequestContext, baseUrl: string) {
  const createResponse = await request.post("/api/ai/clients", {
    data: {
      name: `E2E Hermes Plan Client ${Date.now()}`,
      type: "hermes",
      config: {
        baseUrl,
        apiKey: "e2e-hermes-key",
        timeoutMs: 120_000,
      },
      isDefault: true,
    },
  });
  if (!createResponse.ok()) {
    throw new Error(`Hermes client creation failed (${createResponse.status()}): ${await createResponse.text()}`);
  }

  const created = await createResponse.json() as { client: { id: string } };
  expect(created.client.id).toBeTruthy();

  const bindResponse = await request.put(`/api/ai/clients/${created.client.id}/bindings`, {
    data: { features: ["generate_plan"] },
  });
  expect(bindResponse.ok()).toBeTruthy();
}

async function createTask(request: APIRequestContext): Promise<CreatedTask> {
  const workspaceResponse = await request.get("/api/workspaces/default");
  expect(workspaceResponse.ok()).toBeTruthy();

  const workspaceBody = await workspaceResponse.json() as {
    id?: string;
    workspace?: { id?: string };
    workspaceId?: string;
  };
  const workspaceId = workspaceBody.workspaceId ?? workspaceBody.id ?? workspaceBody.workspace?.id;
  expect(workspaceId).toBeTruthy();

  const createTaskResponse = await request.post("/api/tasks", {
    data: {
      workspaceId,
      title: `E2E Hermes Plan Task ${Date.now()}`,
      description: "Generate an implementation plan through the Hermes provider path.",
      priority: "Medium",
    },
  });
  expect(createTaskResponse.ok()).toBeTruthy();

  const createdTask = await createTaskResponse.json() as CreatedTask;
  expect(createdTask.taskId).toBeTruthy();
  expect(createdTask.workspaceId).toBeTruthy();
  return createdTask;
}

test.describe("Task Plan Generation via Hermes", () => {
  test("generates and renders a task plan through Hermes MCP tools", async ({
    page,
    request,
  }) => {
    const hermes = await startMockHermesServer();

    try {
      await test.step("1. Configure Hermes as task plan generation client", async () => {
        await createHermesPlanClient(request, hermes.url);
      });

      let createdTask: CreatedTask | undefined;
      await test.step("2. Create a task and open its workspace", async () => {
        createdTask = await createTask(request);
        await page.goto(`/en/tasks/${createdTask.taskId}`);

        const taskEditor = page.getByRole("dialog", { name: "Edit task" });
        if (await taskEditor.isVisible()) {
          await taskEditor.getByRole("button", { name: "Close task editor" }).click();
          await expect(taskEditor).not.toBeVisible();
        }
        await expect(page.getByRole("heading", { name: "You can create a plan now" })).toBeVisible();
      });

      await test.step("3. Generate a draft plan through Hermes", async () => {
        const commandRequest = page.waitForResponse((response) => response.url().includes(`/api/work/${createdTask?.taskId}/commands`) && response.request().method() === "POST");
        await page.getByRole("button", { name: "Generate plan" }).first().click();
        await commandRequest;

        await expect(page.getByRole("region", { name: "Execution flow" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText("Collect task context").first()).toBeVisible();
        await expect(page.getByText("Implement solution").first()).toBeVisible();
        await expect(page.getByText("Review before done").first()).toBeVisible();
      });

      await test.step("4. Verify Hermes received a generate_plan run with plan session", async () => {
        expect(hermes.runs).toHaveLength(1);
        const run = hermes.runs[0];
        expect(run.session_id).toBeTruthy();
        expect(run.instructions).toContain("chrona_plan_generate");
        expect(run.input).toContain("E2E Hermes Plan Task");
      });

    } finally {
      hermes.stop();
    }
  });
});
