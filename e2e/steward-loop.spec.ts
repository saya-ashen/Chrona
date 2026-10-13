import { expect, test, type Page } from "@playwright/test";

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "The rendered page must not scroll horizontally").toBe(true);
}

test("never-run steward warns before its first tick", async ({ page }) => {
  await page.goto("/en/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText("The steward has not run recently");
  await expect(page.getByRole("region", { name: "Steward status" })).toContainText("Last tick: never");
  await noOverflow(page);
});

// All product writes go through visible controls. The seam only supplies source
// messages, assessor availability and scheduler ticks; no product records seeded.
test("owner completes the steward loop", async ({ page, request }, info) => {
  let workspaceId = "";
  page.on("request", req => {
    const url = new URL(req.url());
    if (url.pathname === "/api/steward/today") workspaceId = url.searchParams.get("workspaceId") ?? "";
  });
  async function seam(path: string, data?: unknown) {
    const response = await request.post(`/api/test/steward/${path}`, { data });
    expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
    return response.json();
  }
  async function tick() {
    expect(workspaceId).not.toBe("");
    return seam(`tick?workspaceId=${encodeURIComponent(workspaceId)}`);
  }
  async function load(path: string, heading: string) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
    await noOverflow(page);
  }
  async function today() {
    await load("/en/today", "Today");
  }
  const suffix = info.project.name;
  const connectionName = `Local source ${suffix}`;
  const affairName = `Application ${suffix}`;
  const keyword = `application-${suffix}`;
  const purpose = `Watch application deadlines ${suffix}`;
  const title = `${keyword}: please confirm deadline`;
  const body = `Please confirm ${keyword} documents by 2099-12-01. No external reply authorized.`;
  async function push(externalId: string, messageTitle: string, messageBody: string) {
    await seam("local-source/push", { items: [{ externalId: `${suffix}-${externalId}`, title: messageTitle,
      body: messageBody, author: "Local fixture", url: null, occurredAt: new Date().toISOString() }] });
  }

  await test.step("default route, navigation and empty steward status", async () => {
    await load("/en", "Today");
    await expect(page).toHaveURL(/\/en\/today$/);
    await tick();
    await today();
    // Desktop sidebar is a named list; compact layouts use a named nav.
    const nav = page.getByRole("navigation", { name: "Primary navigation" })
      .or(page.getByRole("list", { name: "Primary navigation" }));
    for (const name of ["Today", "Affairs", "Schedule", "Delegations", "Connections & permissions"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("status").filter({ hasText: "All clear — nothing needs your attention." })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  await test.step("create local connection and establish baseline", async () => {
    await load("/en/connections", "Connections & permissions");
    await expect(page.getByRole("combobox", { name: "Kind", exact: true })).toContainText("Local test");
    await page.getByLabel("Label", { exact: true }).fill(connectionName);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: connectionName, exact: true }) });
    await expect(card.getByText("Test data", { exact: true })).toBeVisible();
    await expect(card.getByRole("heading", { name: "Coverage & gaps" })).toBeVisible();
    await expect(card.getByText("LOCAL TEST DATA only; in-memory polling, not a real account. Lost on restart.", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("Baseline: Yes");
    await today();
    await expect(page.getByText("All clear — nothing needs your attention.", { exact: true })).toBeVisible();
  });

  await test.step("create affair and explicitly grant proposed delegation", async () => {
    await load("/en/affairs", "Affairs");
    await page.getByLabel("Title", { exact: true }).fill(affairName);
    await page.getByLabel("Keywords (comma-separated)").fill(keyword);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("link", { name: affairName, exact: true })).toBeVisible();
    await load("/en/delegations", "Delegations");
    await page.getByLabel("Purpose", { exact: true }).fill(purpose);
    await page.getByRole("combobox", { name: "Connection", exact: true }).click();
    await page.getByRole("option", { name: connectionName, exact: true }).click();
    for (const groupName of ["Allowed actions", "Ask-first actions"]) {
      const group = page.getByRole("group", { name: groupName, exact: true });
      for (const action of ["Reply externally", "Mark read externally", "Delete externally"]) {
        await expect(group.getByRole("checkbox", { name: action, exact: true })).toBeDisabled();
      }
    }
    const allowed = page.getByRole("group", { name: "Allowed actions", exact: true });
    for (const action of ["Read source", "Summarize", "Notify you"]) {
      await allowed.getByRole("checkbox", { name: action, exact: true }).check();
    }
    await page.getByRole("button", { name: "Propose delegation", exact: true }).click();
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: purpose, exact: true }) });
    await expect(card.getByText("Proposed", { exact: true })).toBeVisible();
    await expect(card.getByText("Active", { exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: "Grant", exact: true }).click();
    await expect(card.getByText("Active", { exact: true })).toBeVisible();
  });

  await test.step("deadline evidence produces exactly one durable decision", async () => {
    await push("deadline", title, body);
    await tick();
    await today();
    const decisions = page.getByRole("region", { name: "Decisions", exact: true });
    await expect(decisions.getByRole("button", { name: "Approve", exact: true })).toHaveCount(1);
    await expect(decisions.getByText("What happened", { exact: true })).toBeVisible();
    await expect(decisions.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
    await expect(decisions.getByRole("definition").filter({ hasText: title })).toHaveCount(1);
    await expect(decisions.getByText("Why it matters", { exact: true })).toBeVisible();
    await expect(decisions).toContainText("A request includes a date or deadline; user confirmation is required.");
    await expect(decisions.getByRole("blockquote")).toHaveText(body);
    await expect(decisions.getByText("Next step", { exact: true })).toBeVisible();
    await expect(decisions).toContainText("Confirm the request and proposed follow-up; no external action has been authorized.");
    await tick();
    await today();
    await expect(decisions.getByRole("button", { name: "Approve", exact: true })).toHaveCount(1);
  });

  await test.step("confirm suggested affair link and resolve attention", async () => {
    await load("/en/affairs", "Affairs");
    await page.getByRole("link", { name: affairName, exact: true }).click();
    await expect(page.getByRole("heading", { name: affairName, exact: true, level: 1 })).toBeVisible();
    await noOverflow(page);
    const suggested = page.getByRole("region", { name: "Possibly related — confirm?", exact: true });
    await expect(suggested.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const messages = page.getByRole("region", { name: "Messages", exact: true });
    await expect(messages.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
    await suggested.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(messages.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(suggested).toHaveCount(0);
    await today();
    await page.getByRole("region", { name: "Decisions", exact: true }).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("region", { name: "Decisions", exact: true })).toHaveCount(0);
  });

  await test.step("assessor outage is visible and pending work recovers", async () => {
    await seam("assessor", { available: false });
    await push("outage", "Automated newsletter", "No action required.");
    await tick();
    await today();
    await expect(page.getByRole("alert")).toContainText("Assessor unavailable — incoming events remain pending.");
    await expect(page.getByRole("alert")).toContainText("Pending events: 1");
    await seam("assessor", { available: true });
    // Honor production's 30-second assessment retry backoff; do not change DB/time.
    await expect.poll(async () => (await tick()).assessed, { timeout: 40_000, intervals: [1000] }).toBe(1);
    await today();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  await test.step("pause refuses synchronization and revoked delegation has no actions", async () => {
    await load("/en/connections", "Connections & permissions");
    const connection = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: connectionName, exact: true }) });
    await connection.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(connection.getByText("Paused", { exact: true })).toBeVisible();
    await expect(connection.getByRole("button", { name: "Sync now", exact: true })).toHaveCount(0);
    await connection.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(connection.getByText("Active", { exact: true })).toBeVisible();
    await expect(connection.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
    await load("/en/delegations", "Delegations");
    const delegation = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: purpose, exact: true }) });
    // Deliver while permission is active; inspect the receipt after revocation.
    await push("notification", `Preference ${suffix}`, "What is your preference?");
    await tick();
    await delegation.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(delegation.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(delegation.getByRole("button")).toHaveCount(0);
    await noOverflow(page);
  });

  await test.step("11: choose the lightest handling and explicitly enable a validated tool", async () => {
    await load("/en/affairs", "Affairs");
    await page.getByRole("link", { name: affairName, exact: true }).click();
    await expect(page.getByRole("heading", { name: affairName, exact: true, level: 1 })).toBeVisible();
    await noOverflow(page);
    const tools = page.getByRole("region", { name: "Tools", exact: true });
    await tools.getByText("Does this need a tool?", { exact: true }).click();
    await tools.getByLabel("Name", { exact: true }).fill(`Deadline filter ${suffix}`);
    await tools.getByLabel("Purpose", { exact: true }).fill("Keep matching application updates together");
    for (const [question, answer] of [["How often will this repeat?", "Once"], ["Is the goal clear?", "Clear"], ["What is the risk?", "Low"]]) {
      await tools.getByRole("combobox", { name: question, exact: true }).click();
      await page.getByRole("option", { name: answer, exact: true }).click();
    }
    await tools.getByLabel("Keywords (comma-separated)").fill(keyword);
    await tools.getByLabel("Note", { exact: true }).fill("Include application updates in the digest");
    await tools.getByRole("group", { name: "Sample cases 1", exact: true }).getByLabel("Sample title", { exact: true }).fill(keyword);
    await tools.getByRole("group", { name: "Sample cases 2", exact: true }).getByLabel("Sample title", { exact: true }).fill("Unrelated newsletter");
    await tools.getByRole("button", { name: "Choose handling", exact: true }).click();
    await expect(tools.getByRole("status")).toContainText("No tool needed:");
    await expect(tools.getByRole("status")).toContainText("Direct answer");
    await expect(tools.getByRole("status")).toHaveText(/No tool needed: .+/);
    for (const [question, answer] of [["How often will this repeat?", "Regularly"], ["Are the rules stable?", "Yes"]]) {
      await tools.getByRole("combobox", { name: question, exact: true }).click();
      await page.getByRole("option", { name: answer, exact: true }).click();
    }
    await tools.getByRole("button", { name: "Choose handling", exact: true }).click();
    await expect(tools.getByRole("heading", { name: `Deadline filter ${suffix}`, exact: true })).toBeVisible();
    await expect(tools.getByText("Generated", { exact: true })).toBeVisible();
    const progress = tools.getByRole("list", { name: "Tool progress" });
    await expect(progress.locator('[aria-current="step"]')).toContainText("Generated");
    for (const [action, state] of [["Validate", "Validated"], ["Authorize", "Authorized"], ["Enable", "Enabled"]]) {
      await tools.getByRole("button", { name: action, exact: true }).click();
      await expect(tools.getByText(state, { exact: true })).toBeVisible();
      await expect(progress.locator('[aria-current="step"]')).toContainText(state);
      await noOverflow(page);
    }
  });

  await test.step("12: acknowledging delivery does not close the Today item", async () => {
    await load("/en/connections", "Connections & permissions");
    await page.getByText("Delivery log", { exact: true }).click();
    const receipt = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `Preference ${suffix}`, exact: true }) });
    await expect(receipt.getByText("Sent", { exact: true })).toBeVisible();
    await expect(receipt).toContainText("Channel: In Chrona");
    await receipt.getByRole("button", { name: "Acknowledge", exact: true }).click();
    await expect(receipt.getByText("Acknowledged", { exact: true })).toBeVisible();
    await expect(receipt.getByRole("button", { name: "Acknowledge", exact: true })).toHaveCount(0);
    await noOverflow(page);
    await today();
    const changes = page.getByRole("region", { name: "Changes", exact: true });
    await expect(changes.getByRole("heading", { name: `Preference ${suffix}`, exact: true })).toBeVisible();
    await expect(changes.getByText("Status: Open", { exact: true })).toBeVisible();
  });
});
