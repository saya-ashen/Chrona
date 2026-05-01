import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

const SETTINGS_URL = "/en/settings?panel=ai-clients";
const SCHEDULE_URL = "/en/schedule";

// ────────────────────────────── Mock LLM Server ──────────────────────────────
// Starts a Node‑compatible HTTP server that pretends to be an OpenAI‑compatible
// LLM provider. It returns a deterministic plan via SSE streaming so the
// server-side AI pipeline (generatePlan → dispatch → llmCall → fetch) is
// exercised end‑to‑end.

async function startMockLLMServer(planData: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  summary: string;
}) {
  const planJson = JSON.stringify(planData);
  const sseChunk = JSON.stringify({
    choices: [{ delta: { content: planJson } }],
  });
  const body = `data: ${sseChunk}\n\ndata: [DONE]\n\n`;

  let requestCount = 0;
  const server = createServer((_req, res) => {
    requestCount++;
    console.log(`[mock-llm] request #${requestCount}: ${_req.method} ${_req.url}`);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind mock LLM server");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => {
      server.close();
      server.unref();
    },
  };
}

// ────────────────────────────── Test ──────────────────────────────

test("full deterministic AI task flow persists plan updates", async ({
  page,
  request,
}) => {
  const generatedPlan = {
    nodes: [
      {
        id: "node-collect-requirements",
        type: "step",
        title: "Collect requirements",
        objective: "Gather release constraints and scope",
        status: "pending",
        executionMode: "automatic",
      },
      {
        id: "node-draft-implementation",
        type: "step",
        title: "Draft implementation plan",
        objective: "Draft deterministic implementation steps",
        status: "pending",
        executionMode: "automatic",
      },
    ],
    edges: [
      {
        id: "edge-requirements-draft",
        fromNodeId: "node-collect-requirements",
        toNodeId: "node-draft-implementation",
        type: "sequential",
      },
    ],
    summary: "Deterministic release checklist plan",
  };

  const revisedNode = {
    id: "node-review-stakeholder",
    type: "checkpoint",
    title: "Review plan with stakeholder",
    objective: "Review the drafted plan with key stakeholder",
    status: "pending",
    executionMode: "manual",
  };

  // Start a mock LLM provider so server-side AI calls succeed with
  // deterministic plan data.
  const mockLLM = await startMockLLMServer({
    nodes: generatedPlan.nodes,
    edges: generatedPlan.edges,
    summary: generatedPlan.summary,
  });

  try {
    // ── Browser-side mocks ───────────────────────────────────────

    // Mock the "test availability" call (goes through browser → page.route).
    await page.route("**/api/ai/clients/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          available: true,
          reason: "Mock connectivity OK",
        }),
      });
    });

    // Mock the AI chat interaction (returns a deterministic proposal with
    // plan patch data).  This is a browser-side call → page.route handles it.
    await page.route("**/api/ai/task-workspace/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          assistantMessage:
            "Added stakeholder review checkpoint after drafting.",
          proposal: {
            summary: "Add stakeholder review checkpoint",
            confidence: "high",
            planPatch: {
              operation: "add_node",
              nodes: [revisedNode],
              edges: [
                {
                  id: "edge-draft-review",
                  fromNodeId: "node-draft-implementation",
                  toNodeId: "node-review-stakeholder",
                  type: "sequential",
                },
              ],
            },
            requiresConfirmation: false,
          },
        }),
      });
    });

    await test.step("1. Create AI client + test availability", async () => {
      await page.goto(SETTINGS_URL);
      await expect(
        page.getByRole("heading", { name: /manage ai clients/i }),
      ).toBeVisible();
      await page.getByRole("button", { name: /add client/i }).click();
      await page.getByRole("textbox").first().fill("E2E Deterministic Client");
      await page.getByRole("combobox").selectOption("llm");
      await page
        .getByPlaceholder("https://api.openai.com/v1")
        .fill(mockLLM.url);
      await page.getByPlaceholder("sk-...").fill("sk-mock-e2e");
      await page
        .getByRole("button", { name: /test availability/i })
        .first()
        .click();
      await expect(page.getByText(/available/i).first()).toBeVisible();

      const createClientResp = page.waitForResponse(
        (res) =>
          res.url().includes("/api/ai/clients") &&
          res.request().method() === "POST",
      );
      await page.getByRole("button", { name: /^save$/i }).click();
      const createdClient = (await (await createClientResp).json()) as {
        client: { id: string };
      };
      expect(createdClient.client.id).toBeTruthy();
      return createdClient;
    }).then(async (createdClient) => {
      // Bind the client to plan generation and chat features.
      const bindingsResp = await request.put(
        `/api/ai/clients/${createdClient.client.id}/bindings`,
        {
          data: { features: ["generate_plan", "chat"] },
        },
      );
      expect(bindingsResp.ok()).toBeTruthy();
      return createdClient;
    }).then(async () => {
      // ── Create task ────────────────────────────────────────────

      await test.step("2. Create task via UI", async () => {
        await page.goto(SCHEDULE_URL);
        await page.getByRole("button", { name: "Quick add" }).click();
        await page
          .getByPlaceholder("Add title")
          .fill("Prepare deterministic E2E release checklist");
        await page
          .getByPlaceholder("Add description")
          .fill(
            "Create a checklist, review it, and prepare final rollout notes.",
          );

        const createTaskResp = page.waitForResponse(
          (res) =>
            res.url().includes("/api/tasks") && res.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Save" }).click();
        const createdTask = (await (await createTaskResp).json()) as {
          taskId: string;
          workspaceId: string;
        };
        await page.goto(
          `/en/workspaces/${createdTask.workspaceId}/tasks/${createdTask.taskId}`,
        );
        return createdTask;
      }).then(async (createdTask) => {
        // ── AI plan generation (server → mock LLM) ───────────────

        await test.step("3. AI generates plan via mock LLM", async () => {
          console.log(`[e2e] generating plan for task ${createdTask.taskId}...`);
          const genResp = await request.post("/api/ai/generate-task-plan", {
            data: { taskId: createdTask.taskId },
          });
          const genJson = await genResp.json();
          console.log(`[e2e] plan generated: source=${genJson.source}, savedPlan.id=${genJson.savedPlan?.id}`);
          expect(genJson.savedPlan?.id).toBeTruthy();

          await page.reload();

          await expect(
            page.getByText("Collect requirements").first(),
          ).toBeVisible();
          await expect(
            page.getByText("Draft implementation plan").first(),
          ).toBeVisible();
        });

        // ── AI chat interaction ──────────────────────────────────

        await test.step("4. AI chat proposes plan patch", async () => {
          const assistantInput = page.getByPlaceholder(
            "Describe what to change...",
          );
          await assistantInput.fill(
            "Add a stakeholder review checkpoint after drafting.",
          );
          await assistantInput.press("Enter");

          await expect(
            page.getByText("Add stakeholder review checkpoint").first(),
          ).toBeVisible();
        });

        await test.step("5. Apply AI-proposed changes", async () => {
          await page
            .getByRole("button", { name: /apply changes|accept & apply/i })
            .first()
            .click();

          await expect(
            page.getByText("Review plan with stakeholder").first(),
          ).toBeVisible();
        });

        // ── Verify plan persistence ──────────────────────────────

        await test.step("6. Verify plan persisted via API", async () => {
          const planStateResp = await request.get(
            `/api/tasks/${createdTask.taskId}/plan-state`,
          );
          expect(planStateResp.ok()).toBeTruthy();
          const planState = (await planStateResp.json()) as {
            savedAiPlan?: { plan?: { nodes?: Array<{ title: string }> } };
          };
          const titles = (planState.savedAiPlan?.plan?.nodes ?? []).map(
            (n) => n.title,
          );
          expect(titles).toContain("Review plan with stakeholder");
          console.log(`[e2e] final plan nodes: ${titles.join(", ")}`);
        });
      });
    });
  } finally {
    mockLLM.stop();
  }
});
