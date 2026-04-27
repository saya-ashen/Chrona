import { test } from "@playwright/test";

const TITLE = "Set up OpenClaw Agent Runtime for Production";
const DESCRIPTION = [
  "Deploy and configure the OpenClaw agent runtime bridge in production. We need to:",
  "(1) set up the gateway with TLS and proper authentication,",
  "(2) configure rate limiting and resource quotas,",
  "(3) integrate health monitoring with Prometheus + Grafana dashboards,",
  "(4) create a failover strategy with health checks and auto-restart,",
  "(5) build a CI/CD pipeline that deploys agents via GitHub Actions with approval gates.",
  "The agent must be able to autonomously execute deployment tasks when given approval",
  "and report execution status back to the task workspace.",
].join("\n");

const ASSISTANT_MESSAGE = [
  "Review the plan graph and assess its completeness. Consider:",
  "(1) are there any rollback or recovery steps missing,",
  "(2) can any of the sequential steps be parallelized to reduce total execution time,",
  "(3) should we add a smoke test after deployment, and",
  "(4) does the plan adequately cover secrets rotation and access token lifecycle management?",
].join("\n");

const WORKSPACE_ID = "ws_default";

let taskId: string;

test.setTimeout(300_000); // 5 min per test (AI generation can be slow)

test.describe.serial("Chrona README demo recordings", () => {
  test("Demo 1 — Schedule: Quick Add → AI plan → accept", async ({ page }) => {
    // ── Navigate ──
    await page.goto("/en/schedule");
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: "Schedule", exact: true }).waitFor();
    await page.waitForTimeout(800);

    // ── Open Quick Add dialog ──
    await page.getByRole("button", { name: "Quick add" }).click();
    await page.waitForTimeout(600);

    // ── Fill title ──
    await page.getByPlaceholder("Add title").fill(TITLE);
    await page.waitForTimeout(300);

    // ── Fill description ──
    await page.getByPlaceholder("Add description").fill(DESCRIPTION);
    await page.waitForTimeout(400);

    // ── Click "Generate plan" ──
    await page.getByRole("button", { name: "Generate plan" }).click();

    // ── Wait for AI to finish generating the plan ──
    // The "Generate plan" button is replaced by plan content + "Apply Plan"
    await page.getByRole("button", { name: "Apply Plan" }).waitFor({
      state: "visible",
      timeout: 180_000,
    });
    await page.waitForTimeout(500);

    // ── Click "Apply Plan" ──
    await page.getByRole("button", { name: "Apply Plan" }).click({ force: true });

    // ── Wait for navigation to the task detail view ──
    await page.waitForURL(/\/workspaces\/ws_default\/tasks\//, { timeout: 15_000 });
    await page.waitForTimeout(800);

    // ── Capture task ID ──
    const url = page.url();
    const match = url.match(/\/tasks\/([a-zA-Z0-9]+)/);
    if (match) {
      taskId = match[1];
      console.log(`  → task created: ${taskId}`);
    }
  });

  test("Demo 2 — Task workspace: assistant review → accept plan", async ({ page }) => {
    if (!taskId) {
      // Fallback: fetch latest task from API
      const resp = await page.request.get(
        `/api/workspaces/${WORKSPACE_ID}/tasks?limit=1`,
      );
      const json = await resp.json();
      if (json.tasks?.length) {
        taskId = json.tasks[0].id;
      } else {
        throw new Error("No task ID available — run Demo 1 first");
      }
    }

    // ── Navigate to task workspace ──
    await page.goto(`/en/workspaces/${WORKSPACE_ID}/tasks/${taskId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // ── Type assistant message ──
    const assistantInput = page.getByRole("textbox", {
      name: "Describe what to change...",
    });
    await assistantInput.fill(ASSISTANT_MESSAGE);
    await page.waitForTimeout(300);

    // ── Submit by pressing Enter ──
    await assistantInput.press("Enter");
    await page.waitForTimeout(500);

    // ── Wait for AI response ──
    // "Thinking..." indicator appears while processing
    await page.getByText("Thinking...").waitFor({ state: "visible", timeout: 15_000 });
    // Wait for it to disappear (response complete)
    await page.getByText("Thinking...").waitFor({ state: "hidden", timeout: 120_000 });
    await page.waitForTimeout(800);

    // ── Click "Accept Plan" ──
    await page.getByRole("button", { name: "Accept Plan" }).click({ force: true });

    // ── Verify plan was accepted ──
    await page.waitForFunction(
      () => document.body.textContent?.includes("accepted"),
      { timeout: 10_000 },
    );
    await page.waitForTimeout(500);
  });
});
