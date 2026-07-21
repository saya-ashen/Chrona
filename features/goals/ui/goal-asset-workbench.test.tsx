import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import en from "@chrona/i18n/messages/en.json";
import { GoalAssetWorkbench } from "./goal-asset-workbench";
import type { GoalAssetWorkbenchData } from "../workbench-api";

const mocks = vi.hoisted(() => ({
  saveGoalAssetDraft: vi.fn(async () => ({ id: "draft-saved" })),
  submitGoalAssetDraft: vi.fn(async () => ({ id: "version-published" })),
  submitGoalForm: vi.fn(async () => ({ id: "submission-saved" })),
}));

vi.mock("../workbench-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../workbench-api")>(),
  archiveGoalAsset: vi.fn(async () => ({})),
  createGoalAssetJob: vi.fn(async () => ({})),
  createGoalAssetModificationTask: vi.fn(async () => ({})),
  renameGoalAsset: vi.fn(async () => ({})),
  resolveGoalInboxCandidate: vi.fn(async () => ({})),
  restoreGoalAssetVersion: vi.fn(async () => ({})),
  saveGoalAssetDraft: mocks.saveGoalAssetDraft,
  submitGoalAssetDraft: mocks.submitGoalAssetDraft,
  submitGoalForm: mocks.submitGoalForm,
}));

const copy = en.pages.goals.assetWorkbench;

function asset(id: string, label: string, content: string | Record<string, unknown>, version = 1, kind: GoalAssetWorkbenchData["kind"] = "document"): GoalAssetWorkbenchData {
  return {
    id,
    workspaceId: "workspace-1",
    goalId: "goal-1",
    label,
    kind,
    status: "Approved",
    archivedAt: null,
    lastOpenedAt: null,
    updatedAt: `2026-07-0${version}T00:00:00.000Z`,
    sourceArtifact: {
      id: `artifact-${id}`,
      taskId: `task-${id}`,
      runId: `run-${id}`,
      title: `${label} source`,
      uri: `generated://${id}.md`,
      contentPreview: typeof content === "string" ? content : JSON.stringify(content),
      metadata: {},
    },
    versions: [{
      id: `version-${id}-${version}`,
      version,
      parentVersionId: null,
      source: "inbox",
      content,
      contentHash: `hash-${id}-${version}`,
      mimeType: "text/markdown",
      originalFilename: `${id}.md`,
      changeSummary: "Initial version",
      sourceTaskId: `task-${id}`,
      sourceRunId: `run-${id}`,
      sourceResultId: `run-${id}`,
      artifactId: `artifact-${id}`,
      createdAt: `2026-07-0${version}T00:00:00.000Z`,
    }],
    drafts: [],
    submissions: [],
    jobs: [],
  };
}

function renderWorkbench(initialAssets: GoalAssetWorkbenchData[], initialEntry = "/goals/goal-1?section=workbench") {
  const router = createMemoryRouter([{
    path: "/goals/goal-1",
    element: <GoalAssetWorkbench goalId="goal-1" workspaceId="workspace-1" copy={copy} initialAssets={initialAssets} initialRecent={[]} initialCandidates={[]} />,
  }], { initialEntries: [initialEntry] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("GoalAssetWorkbench", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("autosaves after 800ms and cancels the pending timer on asset switch", async () => {
    vi.useFakeTimers();
    mocks.saveGoalAssetDraft.mockClear();
    const first = asset("first", "First document", "First content");
    const second = asset("second", "Second document", "Second content", 2);
    const router = renderWorkbench([first, second], "/goals/goal-1?section=workbench&asset=first");

    fireEvent.change(screen.getByRole("textbox", { name: copy.documentContent }), { target: { value: "Autosave first edit" } });
    await vi.advanceTimersByTimeAsync(799);
    expect(mocks.saveGoalAssetDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.saveGoalAssetDraft).toHaveBeenCalledWith("goal-1", "first", expect.objectContaining({ content: "Autosave first edit" }));

    mocks.saveGoalAssetDraft.mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: copy.documentContent }), { target: { value: "Discard this pending edit" } });
    await act(async () => { await router.navigate("/goals/goal-1?section=workbench&asset=second"); });
    await vi.advanceTimersByTimeAsync(800);
    expect(mocks.saveGoalAssetDraft).not.toHaveBeenCalled();
  });
  it("restores selected asset and filters from the URL", async () => {
    const first = asset("first", "First document", "First content");
    const second = asset("second", "Second document", "Second content", 2);
    renderWorkbench([first, second], "/goals/goal-1?section=workbench&asset=second&assetQuery=Second");

    expect(await screen.findByRole("dialog")).toHaveTextContent("Second document");
    expect(screen.getByLabelText(copy.searchAssets)).toHaveValue("Second");
    expect(screen.getByRole("textbox", { name: copy.documentContent })).toHaveValue("Second content");
  });

  it("resets editor-local state when the selected asset changes", async () => {
    const first = asset("first", "First document", "First content");
    const second = asset("second", "Second document", "Second content", 2);
    const router = renderWorkbench([first, second], "/goals/goal-1?section=workbench&asset=first");

    const editor = screen.getByRole("textbox", { name: copy.documentContent });
    fireEvent.change(editor, { target: { value: "Unsaved first edit" } });
    expect(editor).toHaveValue("Unsaved first edit");

    await router.navigate("/goals/goal-1?section=workbench&asset=second");
    await waitFor(() => expect(screen.getByRole("textbox", { name: copy.documentContent })).toHaveValue("Second content"));
    expect(screen.getByLabelText(copy.titleLabel)).toHaveValue("Second document");
  });

  it("publishes the current editor value through a fresh draft", async () => {
    mocks.saveGoalAssetDraft.mockClear();
    mocks.submitGoalAssetDraft.mockClear();
    mocks.saveGoalAssetDraft.mockResolvedValueOnce({ id: "draft-current" });
    renderWorkbench([asset("first", "First document", "First content")], "/goals/goal-1?section=workbench&asset=first");

    fireEvent.change(screen.getByRole("textbox", { name: copy.documentContent }), { target: { value: "Newest editor content" } });
    fireEvent.click(screen.getByRole("button", { name: copy.publishVersion }));

    await waitFor(() => expect(mocks.submitGoalAssetDraft).toHaveBeenCalledWith("goal-1", "first", {
      workspaceId: "workspace-1",
      draftId: "draft-current",
      changeSummary: copy.manualEditSummary,
    }));
    expect(mocks.saveGoalAssetDraft).toHaveBeenCalledWith("goal-1", "first", expect.objectContaining({
      workspaceId: "workspace-1",
      baseVersionId: "version-first-1",
      content: "Newest editor content",
    }));
  });

  it("creates a version-bound Form submission without changing the definition", async () => {
    mocks.submitGoalForm.mockClear();
    const form = asset("form", "Selection criteria", { fields: [
      { id: "theme", label: "Research theme", type: "textarea", required: true },
      { id: "funded", label: "Full funding", type: "checkbox", required: true },
    ] }, 1, "form");
    renderWorkbench([form], "/goals/goal-1?section=workbench&asset=form");

    expect(screen.getByRole("tab", { name: copy.fillMode })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByLabelText(/Research theme/), { target: { value: "Trustworthy deep learning" } });
    fireEvent.click(screen.getByLabelText(/Full funding/));
    fireEvent.click(screen.getByRole("button", { name: copy.submitForm }));

    await waitFor(() => expect(mocks.submitGoalForm).toHaveBeenCalledWith("goal-1", "form", {
      workspaceId: "workspace-1",
      versionId: "version-form-1",
      content: { theme: "Trustworthy deep learning", funded: true },
    }));
    expect(screen.queryByText("previewSubmission")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: copy.designMode }));
    await waitFor(() => expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: copy.formSchema }).value).toContain('"fields"'));
  });
  it("fills the formal Form version while an unpublished design draft is active", async () => {
    mocks.submitGoalForm.mockClear();
    const form = asset("form-draft", "Selection criteria", { fields: [
      { id: "formalTheme", label: "Formal research theme", type: "textarea", required: true },
    ] }, 1, "form");
    form.drafts = [{
      id: "draft-form-2",
      baseVersionId: "version-form-draft-1",
      content: { fields: [{ id: "draftOnly", label: "Draft-only field", type: "text", required: true }] },
      status: "Active",
      updatedAt: "2026-07-02T00:00:00.000Z",
    }];
    renderWorkbench([form], "/goals/goal-1?section=workbench&asset=form-draft");


    expect(screen.getByLabelText(/Formal research theme/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Draft-only field/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Formal research theme/), { target: { value: "Reliable AI" } });
    fireEvent.click(screen.getByRole("button", { name: copy.submitForm }));

    await waitFor(() => expect(mocks.submitGoalForm).toHaveBeenCalledWith("goal-1", "form-draft", {
      workspaceId: "workspace-1",
      versionId: "version-form-draft-1",
      content: { formalTheme: "Reliable AI" },
    }));
    await userEvent.click(screen.getByRole("tab", { name: copy.designMode }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: copy.formSchema }).value).toContain("draftOnly");
  });
});
