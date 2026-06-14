import { expect, test, type APIRequestContext } from "@playwright/test";

// Schedule proposal — accept/reject decision via the inbox UI.
//
// Covers the user-driven accept path on the Inbox page: seed a
// Pending schedule proposal, navigate to /inbox, click "Accept
// Proposal", and assert the inbox list filters the proposal out
// after it transitions to Accepted in the DB.
//
// The proposal-create endpoint is exercised for setup; the
// proposal-decision endpoint is exercised by the user click.

async function getDefaultWorkspaceId(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/workspaces/default");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string; workspaceId?: string; workspace?: { id?: string } };
  const workspaceId = body.workspaceId ?? body.id ?? body.workspace?.id;
  expect(workspaceId).toBeTruthy();
  return workspaceId as string;
}

async function createTaskWithWorkspace(
  request: APIRequestContext,
  input: { title: string; description?: string },
) {
  const workspaceId = await getDefaultWorkspaceId(request);
  const response = await request.post("/api/tasks", {
    data: {
      workspaceId,
      title: input.title,
      description: input.description ?? "",
      priority: "Medium",
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { taskId: string };
  return { taskId: body.taskId, workspaceId };
}

test.describe("schedule proposal accept/reject via inbox", () => {
  test("accepting a proposal via the inbox removes it from the pending list", async ({ page, request }, testInfo) => {
    // Each run gets a unique title so concurrent retries don't
    // collide on the card selector.
    const uniqueTitle = `Schedule proposal inbox ${testInfo.project.name} ${crypto.randomUUID()}`;
    const { taskId, workspaceId } = await createTaskWithWorkspace(request, {
      title: uniqueTitle,
    });

    // Seed a Pending proposal.
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    const proposalResponse = await request.post(`/api/tasks/${taskId}/schedule/proposals`, {
      data: {
        workspaceId,
        source: "ai",
        proposedBy: "planner",
        summary: "Suggested time slot",
        scheduledStartAt: start,
        scheduledEndAt: end,
      },
    });
    expect(proposalResponse.ok()).toBeTruthy();
    // Capture our proposalId for scoped assertions across retries.
    const proposalBody = (await proposalResponse.json()) as { proposalId: string };
    const proposalId = proposalBody.proposalId;
    expect(proposalId).toBeTruthy();

    // Verify the proposal is now in the inbox's Pending list.
    const inboxBefore = await request.get(
      `/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    expect(inboxBefore.ok()).toBeTruthy();
    const inboxBeforeBody = (await inboxBefore.json()) as Array<{ kind: string; id: string }>;
    expect(
      inboxBeforeBody.some((i) => i.kind === "schedule_proposal" && i.id === proposalId),
    ).toBe(true);

    // Navigate to inbox — the proposal should appear in a card.
    // First goto may load the page; second goto is the one we
    // observe the API call on. Wait specifically for the
    // GET /api/inbox response.
    const inboxResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/inbox") && response.request().method() === "GET",
    );
    await page.goto("/en/inbox");
    const inboxResponse = await inboxResponsePromise;
    expect(inboxResponse.ok()).toBeTruthy();

    // shadcn's Card renders to <div data-slot="card">. The
    // CardDescription contains the unique task title we created,
    // so the filter scopes to our card (avoids overlap with
    // parallel runs and leftover DB state).
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: uniqueTitle })
      .first();
    await expect(card).toBeVisible();
    // Sanity: the empty-state copy should NOT be visible.
    await expect(page.getByText("You're all caught up")).toBeHidden();

    // Click "Accept Proposal" inside the same card.
    const acceptButton = card.getByRole("button", { name: /accept proposal/i });
    await acceptButton.click();

    // After the accept action, the inbox list filters the item
    // out (setItems at inbox-page-client.tsx:55). The card
    // unmounts.
    await expect(card).toBeHidden();

    // Server-side, our proposal is now Accepted and no longer
    // appears in the inbox's Pending filter. Filter on
    // proposalId so the assertion is robust against other
    // proposals that may exist in the shared dev DB.
    const inboxAfter = await request.get(
      `/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    const inboxAfterBody = (await inboxAfter.json()) as Array<{ kind: string; id: string }>;
    const ourProposalStillPending = inboxAfterBody.some(
      (i) => i.kind === "schedule_proposal" && i.id === proposalId,
    );
    expect(ourProposalStillPending).toBe(false);
  });
});
