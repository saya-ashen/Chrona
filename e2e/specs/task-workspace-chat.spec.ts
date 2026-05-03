import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

const SETTINGS_URL = "/en/settings?panel=ai-clients";

// ────────────────────────────── Mock LLM Server ──────────────────────────────

async function startMockLLMServer(responseText: string) {
  const body = JSON.stringify({
    choices: [{ delta: { content: responseText } }],
  });
  const sseBody = `data: ${body}\n\ndata: [DONE]\n\n`;

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(sseBody);
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

test.describe("Task Workspace Chat", () => {
  test("sends a chat message and displays AI assistant response with proposal", async ({
    page,
    request,
  }) => {
    // Start mock LLM so server-side AI calls succeed
    const mockLLM = await startMockLLMServer(
      JSON.stringify({
        assistantMessage:
          "I suggest adding a code review step to this task plan.",
        proposal: {
          summary: "Add code review step",
          confidence: "medium",
          taskPatch: {
            priority: "High",
          },
          planPatch: {
            operation: "add_node",
            nodes: [
              {
                id: "node-code-review",
                type: "checkpoint",
                title: "Code review",
                objective: "Review the pull request",
                status: "pending",
                executionMode: "manual",
              },
            ],
          },
          requiresConfirmation: true,
        },
      }),
    );

    try {
      await test.step("1. Create an AI client and bind chat feature", async () => {
        await page.goto(SETTINGS_URL);
        await expect(
          page.getByRole("heading", { name: /manage ai clients/i }),
        ).toBeVisible();

        // Create client
        await page.getByRole("button", { name: /add client/i }).click();
        await page
          .getByPlaceholder("My OpenClaw Client")
          .fill("E2E Chat Client");
        await page.getByRole("combobox").selectOption("llm");
        await page
          .getByPlaceholder("https://api.openai.com/v1")
          .fill(mockLLM.url);
        await page.getByPlaceholder("sk-...").fill("sk-chat-e2e");

        const createResp = page.waitForResponse(
          (res) =>
            res.url().includes("/api/ai/clients") &&
            res.request().method() === "POST",
        );
        await page.getByRole("button", { name: /^save$/i }).click();
        const created = (await (await createResp).json()) as {
          client: { id: string };
        };
        expect(created.client.id).toBeTruthy();

        // Bind to chat feature
        const bindResp = await request.put(
          `/api/ai/clients/${created.client.id}/bindings`,
          { data: { features: ["chat"] } },
        );
        expect(bindResp.ok()).toBeTruthy();
      });

      await test.step("2. Create a task and navigate to its workspace", async () => {
        await page.goto("/en/schedule");

        await page.getByRole("button", { name: "Quick add" }).click();
        await page.getByPlaceholder("Add title").fill("E2E Chat Test Task");
        await page
          .getByPlaceholder("Add description")
          .fill("Testing the AI chat assistant.");

        const createTaskResp = page.waitForResponse(
          (res) =>
            res.url().includes("/api/tasks") &&
            res.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Save" }).click();
        const createdTask = (await (await createTaskResp).json()) as {
          taskId: string;
          workspaceId: string;
        };

        await page.goto(
          `/en/workspaces/${createdTask.workspaceId}/tasks/${createdTask.taskId}`,
        );

        // Wait for the assistant section to be visible
        await expect(page.getByText("Assistant")).toBeVisible();
      });

      await test.step("3. Send a message and receive AI response", async () => {
        const assistantInput = page.getByPlaceholder(
          "Describe what to change...",
        );
        await expect(assistantInput).toBeVisible();

        await assistantInput.fill(
          "Add a code review step to the plan.",
        );
        await assistantInput.press("Enter");

        // Wait for the "Thinking..." state to appear and then resolve
        await expect(page.getByText("Thinking...")).toBeVisible();
        await expect(
          page.getByText("I suggest adding a code review step"),
        ).toBeVisible({ timeout: 15000 });
      });

      await test.step("4. Verify the proposal is displayed", async () => {
        // The assistant message should contain a proposal with summary and badges
        await expect(
          page.getByText("Add code review step"),
        ).toBeVisible();

        // Check for proposal badges: task changes, plan changes, requires confirmation
        await expect(
          page.getByText("Task changes"),
        ).toBeVisible();
        await expect(
          page.getByText("Plan changes"),
        ).toBeVisible();
        await expect(
          page.getByText("Requires confirmation"),
        ).toBeVisible();
      });

      await test.step("5. Apply the proposal changes", async () => {
        await page
          .getByRole("button", { name: /apply changes|accept & apply/i })
          .first()
          .click();

        // Wait for the "Applied" state
        await expect(
          page.getByText("Applied"),
        ).toBeVisible({ timeout: 5000 });
      });

      await test.step("6. Send a second message — conversation history works", async () => {
        const assistantInput = page.getByPlaceholder(
          "Describe what to change...",
        );
        await assistantInput.fill("Change the title to 'Updated E2E Task'");
        await assistantInput.press("Enter");

        // Should show the new assistant response
        await expect(
          page.getByText("I suggest adding a code review step"),
        ).toBeVisible({ timeout: 10000 });
      });
    } finally {
      mockLLM.stop();
    }
  });

  test("displays suggestion chips when no messages yet", async ({ page }) => {
    await page.goto("/en/schedule");

    // Quick-add a task
    await page.getByRole("button", { name: "Quick add" }).click();
    await page
      .getByPlaceholder("Add title")
      .fill("E2E Suggestion Chips Test");
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

    // The assistant should show suggestion chips
    await expect(page.getByText("Assistant")).toBeVisible();
    await expect(
      page.getByText("Change the due date to tomorrow"),
    ).toBeVisible();
    await expect(
      page.getByText("Add a testing step to the plan"),
    ).toBeVisible();

    // Click a suggestion chip and verify it fills the input
    await page
      .getByRole("button", { name: "Change the due date to tomorrow" })
      .click();

    // The suggestion text should appear in the textarea
    await expect(
      page.getByPlaceholder("Describe what to change..."),
    ).toHaveValue("Change the due date to tomorrow");
  });
});
