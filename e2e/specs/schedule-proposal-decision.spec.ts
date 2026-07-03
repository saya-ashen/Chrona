import { expect, test, type APIRequestContext } from "@playwright/test";

// Schedule proposal — accept/reject decision through public task API.
//
// Covers current Chrona IA: Inbox route is no longer surfaced; pending
// schedule proposals remain available through `/api/inbox`, and resolution
// happens through `/api/tasks/schedule-proposals/decision`.
//
// The proposal-create endpoint is exercised for setup; decision endpoint is
// exercised for the action; pending inbox read model verifies removal.

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

test.describe("schedule proposal accept/reject", () => {
  test("accepting a proposal removes it from the pending inbox list", async ({ request }, testInfo) => {
    const uniqueTitle = `Schedule proposal inbox ${testInfo.project.name} ${crypto.randomUUID()}`;
    const { taskId, workspaceId } = await createTaskWithWorkspace(request, {
      title: uniqueTitle,
    });

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
    const proposalBody = (await proposalResponse.json()) as { proposalId: string };
    const proposalId = proposalBody.proposalId;
    expect(proposalId).toBeTruthy();

    const inboxBefore = await request.get(
      `/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    expect(inboxBefore.ok()).toBeTruthy();
    const inboxBeforeBody = (await inboxBefore.json()) as Array<{ kind: string; id: string }>;
    expect(
      inboxBeforeBody.some((item) => item.kind === "schedule_proposal" && item.id === proposalId),
    ).toBe(true);

    const decisionResponse = await request.post("/api/tasks/schedule-proposals/decision", {
      data: { proposalId, decision: "Accepted" },
    });
    expect(decisionResponse.ok()).toBeTruthy();
    const decisionBody = (await decisionResponse.json()) as { taskId?: string; workspaceId?: string; proposalId?: string };
    expect(decisionBody).toMatchObject({ taskId, workspaceId, proposalId });

    const inboxAfter = await request.get(
      `/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    expect(inboxAfter.ok()).toBeTruthy();
    const inboxAfterBody = (await inboxAfter.json()) as Array<{ kind: string; id: string }>;
    expect(
      inboxAfterBody.some((item) => item.kind === "schedule_proposal" && item.id === proposalId),
    ).toBe(false);
  });
});
