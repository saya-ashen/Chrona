import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import en from "@chrona/i18n/messages/en.json";
import { GoalAssetWorkbench } from "./goal-asset-workbench";
import type {
  GoalAssetWorkbenchData,
  GoalInboxCandidateData,
} from "../workbench-api";

const mocks = vi.hoisted(() => ({
  applyGoalAssetOwnership: vi.fn(async () => ({})),
  generateGoalAssetOwnership: vi.fn(async () => ({})),
  saveGoalAssetDraft: vi.fn(async () => ({ id: "draft-saved" })),
  submitGoalAssetDraft: vi.fn(async () => ({ id: "version-published" })),
  submitGoalForm: vi.fn(async () => ({ id: "submission-saved" })),
  createGoalAssetJob: vi.fn(async (_goalId: string, _assetId: string, command: { format?: string }) => ({ format: command.format ?? null })),
}));

vi.mock("../workbench-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workbench-api")>()),
  archiveGoalAsset: vi.fn(async () => ({})),
  applyGoalAssetOwnership: mocks.applyGoalAssetOwnership,
  createGoalAssetJob: mocks.createGoalAssetJob,
  createGoalAssetModificationTask: vi.fn(async () => ({})),
  generateGoalAssetOwnership: mocks.generateGoalAssetOwnership,
  renameGoalAsset: vi.fn(async () => ({})),
  resolveGoalInboxCandidate: vi.fn(async () => ({})),
  restoreGoalAssetVersion: vi.fn(async () => ({})),
  saveGoalAssetDraft: mocks.saveGoalAssetDraft,
  submitGoalAssetDraft: mocks.submitGoalAssetDraft,
  submitGoalForm: mocks.submitGoalForm,
}));

const copy = en.pages.goals.assetWorkbench;

function asset(
  id: string,
  label: string,
  content: string | Record<string, unknown>,
  version = 1,
  kind: GoalAssetWorkbenchData["kind"] = "document",
): GoalAssetWorkbenchData {
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
      contentPreview:
        typeof content === "string" ? content : JSON.stringify(content),
      metadata: {},
    },
    versions: [
      {
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
      },
    ],
    drafts: [],
    submissions: [],
    jobs: [],
  };
}

function renderWorkbench(
  initialAssets: GoalAssetWorkbenchData[],
  initialEntry = "/goals/goal-1?section=workbench",
  initialCandidates: GoalInboxCandidateData[] = [],
) {
  const router = createMemoryRouter(
    [
      {
        path: "/goals/goal-1",
        element: (
          <GoalAssetWorkbench
            goalId="goal-1"
            workspaceId="workspace-1"
            copy={copy}
            initialAssets={initialAssets}
            initialRecent={[]}
            initialCandidates={initialCandidates}
          />
        ),
      },
    ],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("GoalAssetWorkbench", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.removeItem("chrona.goalAssets.collapsed");
    window.localStorage.removeItem("chrona.goalAssetDetails.collapsed");
  });

  it("autosaves after 800ms and cancels the pending timer on asset switch", async () => {
    vi.useFakeTimers();
    mocks.saveGoalAssetDraft.mockClear();
    const first = asset("first", "First document", "First content");
    const second = asset("second", "Second document", "Second content", 2);
    const router = renderWorkbench(
      [first, second],
      "/goals/goal-1?section=workbench&asset=first",
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: copy.documentContent }),
      { target: { value: "Autosave first edit" } },
    );
    await vi.advanceTimersByTimeAsync(799);
    expect(mocks.saveGoalAssetDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.saveGoalAssetDraft).toHaveBeenCalledWith(
      "goal-1",
      "first",
      expect.objectContaining({ content: "Autosave first edit" }),
    );

    mocks.saveGoalAssetDraft.mockClear();
    fireEvent.change(
      screen.getByRole("textbox", { name: copy.documentContent }),
      { target: { value: "Discard this pending edit" } },
    );
    await act(async () => {
      await router.navigate("/goals/goal-1?section=workbench&asset=second");
    });
    await vi.advanceTimersByTimeAsync(800);
    expect(mocks.saveGoalAssetDraft).not.toHaveBeenCalled();
  });
  it("restores selected asset and filters from the URL", async () => {
    const first = asset("first", "First document", "First content");
    const second = asset("second", "Second document", "Second content", 2);
    renderWorkbench(
      [first, second],
      "/goals/goal-1?section=workbench&asset=second&assetQuery=Second",
    );

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Second document",
    );
    expect(screen.getByLabelText(copy.searchAssets)).toHaveValue("Second");
    expect(
      screen.getByRole("textbox", { name: copy.documentContent }),
    ).toHaveValue("Second content");
  });

  it("separates archived assets into a top-level Workbench tab", async () => {
    const archived = {
      ...asset("archived", "Archived document", "Archived content", 2),
      status: "Archived",
      archivedAt: "2026-07-03T00:00:00.000Z",
    };
    const router = renderWorkbench(
      [archived],
      "/goals/goal-1?section=workbench&assetView=archived",
    );

    expect(screen.getByRole("tab", { name: copy.archived })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByRole("button", { name: /Archived document/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Archived document/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Archived document");
    expect(screen.getByRole("button", { name: copy.restoreAsset })).toBeInTheDocument();
    expect(router.state.location.search).toContain("assetView=archived");
  });

  it("prioritizes type-specific actions and exposes responsive workspace controls", async () => {
    const file = asset("file", "Source archive", "binary source", 1, "file");
    renderWorkbench([file], "/goals/goal-1?section=workbench&asset=file");

    const workspace = await screen.findByTestId("asset-workspace");
    expect(workspace).toHaveClass("h-full");
    expect(
      screen.getByRole("button", { name: copy.downloadSource }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: copy.saveDraft }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: copy.publishVersion }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.openAssets }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.openDetails }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.currentVersion)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.archiveAsset }),
    ).toBeInTheDocument();
  });

  it("keeps expand controls in collapsed side-panel rails", async () => {
    window.localStorage.removeItem("chrona.goalAssets.collapsed");
    window.localStorage.removeItem("chrona.goalAssetDetails.collapsed");
    renderWorkbench(
      [asset("first", "First document", "First content")],
      "/goals/goal-1?section=workbench&asset=first",
    );

    await userEvent.click(
      screen.getByRole("button", { name: copy.collapseAssets }),
    );
    const assetsRail = document.querySelector(
      '[data-asset-panel="assets-collapsed"]',
    );
    expect(
      within(assetsRail as HTMLElement).getByRole("button", {
        name: copy.openAssets,
      }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: copy.collapseDetails }),
    );
    const detailsRail = document.querySelector(
      '[data-asset-panel="details-collapsed"]',
    );
    expect(
      within(detailsRail as HTMLElement).getByRole("button", {
        name: copy.openDetails,
      }),
    ).toBeInTheDocument();
  });

  it("labels Inbox identity suggestions as rule-based without percentages", async () => {
    const candidate: GoalInboxCandidateData = {
      id: "candidate-1",
      sourceTaskId: "task-1",
      sourceRunId: "run-1",
      kind: "document",
      label: "First document revision",
      proposedAction: "append_version",
      proposedTargetAssetId: "first",
      content: "Revised content",
      reason: "rule_based_name_match",
      changeSummary: "Candidate derived from accepted result “Bounded task”",
      confidence: 1,
      sourceArtifact: null,
      sourceTask: { title: "Bounded task" },
      proposedTargetAsset: { id: "first", label: "First document" },
    };

    renderWorkbench(
      [asset("first", "First document", "First content")],
      "/goals/goal-1?section=workbench&assetView=inbox",
      [candidate],
    );

    expect(await screen.findAllByText(copy.ruleBasedMatch)).not.toHaveLength(0);
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });

  it("renders persisted AI ownership provenance and applies only on explicit confirmation", async () => {
    const candidate: GoalInboxCandidateData = {
      id: "candidate-ai",
      sourceTaskId: "task-1",
      sourceRunId: "run-1",
      kind: "document",
      label: "Reviewed launch brief",
      proposedAction: "create_asset",
      proposedTargetAssetId: null,
      content: "Accepted result",
      reason: "no_rule_based_name_match",
      changeSummary: "Accepted result candidate",
      confidence: 0,
      sourceArtifact: null,
      sourceTask: { title: "Draft launch brief" },
      proposedTargetAsset: null,
      ownershipProposals: [{
        id: "ownership-1",
        status: "Ready",
        sourceTaskId: "ownership-task",
        sourceRunId: "ownership-run",
        providerType: "debug",
        model: "provider/default",
        generationError: null,
        result: {
          schemaVersion: 1,
          decision: "create_asset",
          targetAssetId: null,
          proposedLabel: "Reviewed launch brief",
          rationale: "No safe existing asset matches the accepted result.",
          differenceSummary: "Create a separate formal asset.",
          certainty: "medium",
          evidence: ["Accepted result contains a complete launch brief."],
          counterEvidence: ["No matching asset was supplied."],
        },
        sourceTask: { id: "ownership-task", title: "Review asset ownership" },
        targetAsset: null,
      }],
    };
    renderWorkbench([], "/goals/goal-1?section=workbench&assetView=inbox", [candidate]);

    expect(await screen.findByText(copy.aiRecommendation)).toBeInTheDocument();
    expect(screen.getByText(candidate.ownershipProposals![0]!.result!.rationale)).toBeInTheDocument();
    expect(screen.getByText(/debug/)).toBeInTheDocument();
    expect(mocks.applyGoalAssetOwnership).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: copy.applyAiRecommendation }));
    expect(mocks.applyGoalAssetOwnership).toHaveBeenCalledWith(
      "goal-1",
      "candidate-ai",
      "ownership-1",
      expect.objectContaining({ action: "apply_suggestion", workspaceId: "workspace-1" }),
    );
  });

  it("switches assets inside the desktop asset navigator", async () => {
    const first = asset("first", "First document", "First content");
    const second = asset("second", "Second document", "Second content", 2);
    const router = renderWorkbench(
      [first, second],
      "/goals/goal-1?section=workbench&asset=first",
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Second document/ }),
    );
    await waitFor(() =>
      expect(router.state.location.search).toContain("asset=second"),
    );
    expect(
      screen.getByRole("textbox", { name: copy.documentContent }),
    ).toHaveValue("Second content");
  });

  it("resets editor-local state when the selected asset changes", async () => {
    const first = asset("first", "First document", "First content");
    const second = asset("second", "Second document", "Second content", 2);
    const router = renderWorkbench(
      [first, second],
      "/goals/goal-1?section=workbench&asset=first",
    );

    const editor = screen.getByRole("textbox", { name: copy.documentContent });
    fireEvent.change(editor, { target: { value: "Unsaved first edit" } });
    expect(editor).toHaveValue("Unsaved first edit");

    await router.navigate("/goals/goal-1?section=workbench&asset=second");
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: copy.documentContent }),
      ).toHaveValue("Second content"),
    );
    expect(screen.getByLabelText(copy.titleLabel)).toHaveValue(
      "Second document",
    );
  });

  it("publishes the current editor value through a fresh draft", async () => {
    mocks.saveGoalAssetDraft.mockClear();
    mocks.submitGoalAssetDraft.mockClear();
    mocks.saveGoalAssetDraft.mockResolvedValueOnce({ id: "draft-current" });
    renderWorkbench(
      [asset("first", "First document", "First content")],
      "/goals/goal-1?section=workbench&asset=first",
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: copy.documentContent }),
      { target: { value: "Newest editor content" } },
    );
    fireEvent.click(screen.getByRole("button", { name: copy.publishVersion }));

    await waitFor(() =>
      expect(mocks.submitGoalAssetDraft).toHaveBeenCalledWith(
        "goal-1",
        "first",
        {
          workspaceId: "workspace-1",
          draftId: "draft-current",
          changeSummary: copy.manualEditSummary,
        },
      ),
    );
    expect(mocks.saveGoalAssetDraft).toHaveBeenCalledWith(
      "goal-1",
      "first",
      expect.objectContaining({
        workspaceId: "workspace-1",
        baseVersionId: "version-first-1",
        content: "Newest editor content",
      }),
    );
  });

  it("creates a version-bound Form submission without changing the definition", async () => {
    mocks.submitGoalForm.mockClear();
    const form = asset(
      "form",
      "Selection criteria",
      {
        fields: [
          {
            id: "theme",
            label: "Research theme",
            type: "textarea",
            required: true,
          },
          {
            id: "funded",
            label: "Full funding",
            type: "checkbox",
            required: true,
          },
        ],
      },
      1,
      "form",
    );
    renderWorkbench([form], "/goals/goal-1?section=workbench&asset=form");

    expect(screen.getByRole("tab", { name: copy.fillMode })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.change(screen.getByLabelText(/Research theme/), {
      target: { value: "Trustworthy deep learning" },
    });
    fireEvent.click(screen.getByLabelText(/Full funding/));
    fireEvent.click(screen.getByRole("button", { name: copy.submitForm }));

    await waitFor(() =>
      expect(mocks.submitGoalForm).toHaveBeenCalledWith("goal-1", "form", {
        workspaceId: "workspace-1",
        versionId: "version-form-1",
        content: { theme: "Trustworthy deep learning", funded: true },
      }),
    );
    expect(screen.queryByText("previewSubmission")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: copy.designMode }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
          name: copy.formSchema,
        }).value,
      ).toContain('"fields"'),
    );
  });
  it("fills the formal Form version while an unpublished design draft is active", async () => {
    mocks.submitGoalForm.mockClear();
    const form = asset(
      "form-draft",
      "Selection criteria",
      {
        fields: [
          {
            id: "formalTheme",
            label: "Formal research theme",
            type: "textarea",
            required: true,
          },
        ],
      },
      1,
      "form",
    );
    form.drafts = [
      {
        id: "draft-form-2",
        baseVersionId: "version-form-draft-1",
        content: {
          fields: [
            {
              id: "draftOnly",
              label: "Draft-only field",
              type: "text",
              required: true,
            },
          ],
        },
        status: "Active",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ];
    renderWorkbench([form], "/goals/goal-1?section=workbench&asset=form-draft");

    expect(screen.getByLabelText(/Formal research theme/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Draft-only field/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Formal research theme/), {
      target: { value: "Reliable AI" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.submitForm }));

    await waitFor(() =>
      expect(mocks.submitGoalForm).toHaveBeenCalledWith(
        "goal-1",
        "form-draft",
        {
          workspaceId: "workspace-1",
          versionId: "version-form-draft-1",
          content: { formalTheme: "Reliable AI" },
        },
      ),
    );
    await userEvent.click(screen.getByRole("tab", { name: copy.designMode }));
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: copy.formSchema,
      }).value,
    ).toContain("draftOnly");
  });
  it("renders a structured result without exposing raw JSON and exports each supported format", async () => {
    mocks.createGoalAssetJob.mockClear();
    const structured = asset(
      "structured",
      "Selected destination",
      {
        format: "chrona-json-render",
        schemaVersion: 1,
        catalogVersion: "1.0.0",
        summary: "日照＋临沂沂蒙山",
        spec: {
          root: "root",
          elements: {
            root: { type: "Stack", props: { gap: "md" }, children: ["summary", "risk"] },
            summary: { type: "ResultSummary", props: { text: "日照＋临沂沂蒙山最适合本次旅行。" } },
            risk: { type: "Alert", props: { title: "Travel constraint", description: "Avoid the holiday peak." } },
          },
        },
        artifactRefs: [],
      },
      1,
      "structured_result",
    );
    renderWorkbench([structured], "/goals/goal-1?section=workbench&asset=structured");

    expect(await screen.findByLabelText(copy.structuredResultContent)).toHaveTextContent("日照＋临沂沂蒙山最适合本次旅行。");
    expect(screen.getByText("Travel constraint")).toBeInTheDocument();
    expect(screen.queryByText("chrona-json-render")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.saveDraft })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.export }));
    await waitFor(() => expect(screen.getByText(copy.exportMarkdown)).toBeInTheDocument());
    screen.getByText(copy.exportMarkdown).click();
    await waitFor(() => expect(mocks.createGoalAssetJob).toHaveBeenCalledWith("goal-1", "structured", expect.objectContaining({ format: "md" })));

    await userEvent.click(screen.getByRole("button", { name: copy.export }));
    await waitFor(() => expect(screen.getByText(copy.exportPdf)).toBeInTheDocument());
    screen.getByText(copy.exportPdf).click();
    await waitFor(() => expect(mocks.createGoalAssetJob).toHaveBeenCalledWith("goal-1", "structured", expect.objectContaining({ format: "pdf" })));
  });
});
