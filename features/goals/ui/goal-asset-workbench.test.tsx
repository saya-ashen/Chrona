import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { GoalDataTableContent } from "@chrona/contracts";
import { GoalAssetWorkbench } from "./goal-asset-workbench";
import type {
  GoalAssetWorkbenchData,
  GoalInboxCandidateData,
} from "../workbench-api";

const mocks = vi.hoisted(() => ({
  applyGoalAssetOwnership: vi.fn(async () => ({})),
  discardGoalAssetDraft: vi.fn(async () => ({ id: "draft-discarded", status: "Discarded" })),
  generateGoalAssetOwnership: vi.fn(async () => ({})),
  saveGoalAssetDraft: vi.fn(async () => ({ id: "draft-saved" })),
  submitGoalAssetDraft: vi.fn(async () => ({ id: "version-published" })),
  submitGoalForm: vi.fn(async () => ({ id: "submission-saved" })),
  createGoalAssetJob: vi.fn(
    async (
      _goalId: string,
      _assetId: string,
      command: { format?: string },
    ) => ({ format: command.format ?? null }),
  ),
}));

vi.mock("./goal-asset-canvas-markdown", () => ({
  MarkdownAssetCanvas: ({ mode, value, ariaLabel, onChange }: { mode: "read" | "edit"; value: string; ariaLabel: string; onChange: (value: string) => void }) => mode === "read"
    ? <article aria-label={ariaLabel}><h1>{value.replace(/^#\s*/, "").split("\n")[0]}</h1><p>{value.replaceAll("**", "").split("\n").slice(1).join(" ")}</p></article>
    : <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("./goal-asset-canvas-spreadsheet", () => ({
  SpreadsheetAssetCanvas: ({ mode, label, summary, table, onChange }: {
    mode: "read" | "edit";
    label: string;
    summary: string;
    table: GoalDataTableContent;
    onChange: (table: GoalDataTableContent) => void;
  }) => (
    <section aria-label={label} data-asset-canvas={mode === "edit" ? "spreadsheet-editor" : "data-table"} data-asset-canvas-mode={mode}>
      {summary}
      {mode === "edit" ? (
        <button
          type="button"
          onClick={() => onChange({
            ...table,
            rows: table.rows.map((row, index) => index === 0
              ? { ...row, values: { ...row.values, [table.columns[2]!.id]: "Updated, quoted note" } }
              : row),
          })}
        >
          Update first note
        </button>
      ) : null}
    </section>
  ),
}));


vi.mock("../workbench-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workbench-api")>()),
  archiveGoalAsset: vi.fn(async () => ({})),
  applyGoalAssetOwnership: mocks.applyGoalAssetOwnership,
  discardGoalAssetDraft: mocks.discardGoalAssetDraft,
  createGoalAssetJob: mocks.createGoalAssetJob,
  createGoalAssetModificationTask: vi.fn(async () => ({})),
  createGoalAssetReview: vi.fn(async () => ({})),
  createGoalAssetUseTask: vi.fn(async () => ({})),
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
  file?: { mimeType: string; originalFilename: string },
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
        mimeType: file?.mimeType ?? (kind === "structured_result"
          ? "application/vnd.chrona.structured-result+json"
          : "text/plain"),
        originalFilename: file?.originalFilename ?? `${id}.txt`,
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
    reviews: [],
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

  beforeEach(() => {
    mocks.saveGoalAssetDraft.mockReset();
    mocks.saveGoalAssetDraft.mockResolvedValue({ id: "draft-saved" });
    mocks.submitGoalAssetDraft.mockReset();
    mocks.submitGoalAssetDraft.mockResolvedValue({ id: "version-published" });
    mocks.discardGoalAssetDraft.mockReset();
    mocks.discardGoalAssetDraft.mockResolvedValue({ id: "draft-discarded", status: "Discarded" });
  });
  it("renders Office-style document and quoted CSV previews with derived types", () => {
    const document = asset("brief", "Research brief", "# Priority faculty\nContact the top-ranked labs this week.");
    const spreadsheet = asset(
      "tracker",
      "Application tracker",
      'Faculty,University,Status\n"Smith, Jane",Example University,Ready\nLee,Sample Institute,Draft',
      1,
      "file",
      { mimeType: "text/csv", originalFilename: "application-tracker.csv" },
    );

    renderWorkbench([document, spreadsheet]);

    const documentCard = screen.getByRole("button", { name: /Research brief/ });
    expect(documentCard).toHaveTextContent("Priority faculty");
    const spreadsheetCard = screen.getByRole("button", { name: /Application tracker/ });
    expect(within(spreadsheetCard).getByText(copy.dataTables)).toBeInTheDocument();
    expect(spreadsheetCard).toHaveTextContent("Smith, Jane");
    expect(spreadsheetCard).toHaveTextContent("University");
    expect(within(spreadsheetCard).queryByText(copy.files)).not.toBeInTheDocument();
  });

  it("shows draft timing and discards an autosaved draft after confirmation", async () => {
    const document = asset("brief", "Research brief", "Formal content");
    document.drafts = [{
      id: "draft-brief",
      baseVersionId: document.versions[0]!.id,
      status: "Active",
      content: "Draft content",
      updatedAt: "2026-07-31T01:30:00.000Z",
    }];
    renderWorkbench([document], "/goals/goal-1?section=workbench&asset=brief");

    expect(screen.getAllByText(copy.draftAvailable).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(copy.draftChangedAt.split("{time}")[0]))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.discardDraft }));
    const dialog = await screen.findByRole("dialog", { name: copy.discardDraftTitle });
    expect(within(dialog).getByText(copy.discardDraftDescription)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: copy.discardDraft }));

    await waitFor(() => expect(mocks.discardGoalAssetDraft).toHaveBeenCalledWith("goal-1", "brief", {
      workspaceId: "workspace-1",
      draftId: "draft-brief",
    }));
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

    fireEvent.change(screen.getByRole("textbox", { name: copy.documentContent }), { target: { value: "Autosave first edit" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    expect(mocks.saveGoalAssetDraft).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.saveGoalAssetDraft).toHaveBeenCalledWith(
      "goal-1",
      "first",
      expect.objectContaining({ content: "Autosave first edit" }),
    );

    mocks.saveGoalAssetDraft.mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: copy.documentContent }), { target: { value: "Discard this pending edit" } });
    await act(async () => {
      await router.navigate("/goals/goal-1?section=workbench&asset=second");
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(mocks.saveGoalAssetDraft).not.toHaveBeenCalled();
    await act(async () => {
      await router.navigate("/goals/goal-1?section=workbench&asset=first");
    });
    fireEvent.change(screen.getByRole("textbox", { name: copy.documentContent }), { target: { value: "Never save to the next asset" } });
    await act(async () => {
      await router.navigate("/goals/goal-1?section=workbench&asset=second");
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(mocks.saveGoalAssetDraft).not.toHaveBeenCalledWith("goal-1", "second", expect.anything());
    expect(screen.getByRole("textbox", { name: copy.documentContent })).toHaveValue("Second content");
  });
  it("renders the selected asset content immediately when switching asset kinds", async () => {
    const structured = asset(
      "guide",
      "PhD channel guide",
      {
        format: "chrona-json-render",
        schemaVersion: 1,
        catalogVersion: "1.0.0",
        summary: "Guide ready",
        spec: {
          root: "root",
          elements: {
            root: {
              type: "ResultSummary",
              props: { text: "Structured guide content" },
            },
          },
        },
        artifactRefs: [],
      },
      1,
      "structured_result",
    );
    const tracker = asset("tracker", "Faculty priority tracker", {
      schemaVersion: 1,
      columns: [{ id: "faculty", label: "Faculty", type: "text" }],
      rows: [{ id: "row-1", values: { faculty: "Priority professor" } }],
    }, 1, "data_table");
    const router = renderWorkbench(
      [structured, tracker],
      "/goals/goal-1?section=workbench&asset=guide",
    );

    expect(await screen.findByText("Structured guide content")).toBeInTheDocument();
    await act(async () => {
      await router.navigate("/goals/goal-1?section=workbench&asset=tracker");
    });

    expect(document.querySelector('[data-asset-canvas="spreadsheet-editor"]')).toHaveTextContent("1 rows · 1 columns");
    expect(screen.queryByText("Structured guide content")).not.toBeInTheDocument();
    expect(screen.queryByText("chrona-json-render")).not.toBeInTheDocument();
  });

  it("opens a structured deliverable as its linked Workbench asset", async () => {
    const content = {
      format: "chrona-json-render",
      schemaVersion: 1,
      catalogVersion: "1.0.0",
      summary: "Guide ready",
      spec: {
        root: "deliverable",
        elements: {
          deliverable: {
            type: "ResultDeliverable",
            props: {
              title: "Chinese guide",
              summary: "Primary guide",
              role: "primary",
              kind: "document",
              formatLabel: "Markdown",
              path: "GF0364A5F97C1D",
              contentPreview: "# Guide preview",
            },
          },
        },
      },
      artifactRefs: [
        {
          ref: "GF0364A5F97C1D",
          title: "guide.md",
          mimeType: "text/markdown",
          size: 100,
          checksum: "checksum",
        },
      ],
    };
    const structured = asset(
      "structured",
      "Structured result",
      content,
      1,
      "structured_result",
    );
    structured.linkedAssets = [{ ref: "GF0364A5F97C1D", assetId: "guide" }];
    const guide = asset("guide", "Chinese guide", "# Full guide");
    const router = renderWorkbench(
      [structured, guide],
      "/goals/goal-1?section=workbench&asset=structured",
    );

    const open = await screen.findByRole("link", { name: "Open asset" });
    expect(
      screen.queryByRole("button", { name: "Preview" }),
    ).not.toBeInTheDocument();
    await userEvent.click(open);
    await waitFor(() =>
      expect(router.state.location.search).toContain("asset=guide"),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Chinese guide",
    );
  });

  it("keeps MIME metadata internal when the asset type is already shown", async () => {
    const structured = asset(
      "structured-metadata",
      "Structured result",
      { format: "chrona-json-render" },
      1,
      "structured_result",
    );
    structured.versions[0]!.mimeType =
      "application/vnd.chrona.structured-result+json";
    renderWorkbench(
      [structured],
      "/goals/goal-1?section=workbench&asset=structured-metadata",
    );

    expect(
      (await screen.findAllByText("Structured reports")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("MIME type")).not.toBeInTheDocument();
    expect(
      screen.queryByText("application/vnd.chrona.structured-result+json"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
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
    expect(screen.getByText("Second content")).toBeInTheDocument();
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
    expect(
      screen.getByRole("button", { name: /Archived document/ }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Archived document/ }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Archived document",
    );
    expect(
      screen.getByRole("button", { name: copy.restoreAsset }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toContain("assetView=archived");
  });

  it("opens Markdown assets directly in the unified editor", async () => {
    renderWorkbench([asset("document", "Research brief", "# Editable brief")], "/goals/goal-1?section=workbench&asset=document");

    await screen.findByRole("textbox", { name: copy.documentContent });
    expect(screen.queryByRole("button", { name: copy.previewMode })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.saveDraft })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.publishVersion })).toBeInTheDocument();
  });

  it("prioritizes type-specific actions and exposes responsive workspace controls", async () => {
    const file = asset("file", "Source archive", "binary source", 1, "file");
    renderWorkbench([file], "/goals/goal-1?section=workbench&asset=file");

    const workspace = await screen.findByTestId("asset-workspace");
    expect(workspace).toHaveClass("h-full");
    const downloadActions = screen.getAllByRole("button", { name: copy.downloadSource });
    expect(downloadActions).toHaveLength(1);
    expect(downloadActions[0]).toBeEnabled();
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

  it("groups related candidates by source Task and keeps source content collapsed", async () => {
    const base: GoalInboxCandidateData = {
      id: "candidate-group-1",
      sourceTaskId: "task-group",
      sourceRunId: "run-group",
      kind: "document",
      label: "Launch brief",
      proposedAction: "create_asset",
      proposedTargetAssetId: null,
      content: "# Launch brief\n\nA concise action plan with evidence.",
      reason: "no_rule_based_name_match",
      changeSummary: "Accepted result candidate",
      confidence: 0,
      sourceArtifact: null,
      sourceTask: { title: "Prepare launch materials" },
      proposedTargetAsset: null,
    };
    renderWorkbench([], "/goals/goal-1?section=workbench&assetView=inbox", [
      base,
      { ...base, id: "candidate-group-2", kind: "file", label: "Launch data", content: "name,status\nAlpha,ready" },
    ]);

    expect(await screen.findByRole("heading", { name: "Prepare launch materials" })).toBeInTheDocument();
    expect(screen.getByText(/2 related deliverables share this source Task/)).toBeInTheDocument();
    expect(screen.getAllByText("2 of 2 in this Task").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/A concise action plan with evidence/).length).toBeGreaterThan(0);
    expect(screen.queryByText("# Launch brief", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.reviewInbox })).not.toBeInTheDocument();
  });

  it("generates AI ownership without relying on browser crypto.randomUUID", async () => {
    const candidate: GoalInboxCandidateData = {
      id: "candidate-generate",
      sourceTaskId: "task-generate",
      sourceRunId: "run-generate",
      kind: "document",
      label: "Research brief",
      proposedAction: "create_asset",
      proposedTargetAssetId: null,
      content: "Accepted research brief",
      reason: "no_rule_based_name_match",
      changeSummary: "Accepted result candidate",
      confidence: 0,
      sourceArtifact: null,
      sourceTask: { title: "Prepare research brief" },
      proposedTargetAsset: null,
    };
    const originalRandomUuid = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
    try {
      renderWorkbench([], "/goals/goal-1?section=workbench&assetView=inbox", [candidate]);
      await userEvent.click(await screen.findByRole("button", { name: copy.generateAiRecommendation }));
      expect(mocks.generateGoalAssetOwnership).toHaveBeenCalledWith(
        "goal-1",
        "candidate-generate",
        expect.objectContaining({ workspaceId: "workspace-1", idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
      );
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: originalRandomUuid });
    }
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
      ownershipProposals: [
        {
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
        },
      ],
    };
    renderWorkbench([], "/goals/goal-1?section=workbench&assetView=inbox", [
      candidate,
    ]);

    expect(await screen.findByText(copy.aiRecommendation)).toBeInTheDocument();
    expect(
      screen.getByText(candidate.ownershipProposals![0]!.result!.rationale),
    ).toBeInTheDocument();
    expect(screen.getByText(/debug/)).toBeInTheDocument();
    expect(mocks.applyGoalAssetOwnership).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: copy.applyAiRecommendation }),
    );
    expect(mocks.applyGoalAssetOwnership).toHaveBeenCalledWith(
      "goal-1",
      "candidate-ai",
      "ownership-1",
      expect.objectContaining({
        action: "apply_suggestion",
        workspaceId: "workspace-1",
      }),
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
    expect(await screen.findByText("Second content")).toBeInTheDocument();
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

    await act(async () => {
      await router.navigate("/goals/goal-1?section=workbench&asset=second");
    });
    await screen.findByText("Second content");
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

    fireEvent.change(screen.getByRole("textbox", { name: copy.documentContent }), { target: { value: "Newest editor content" } });
    fireEvent.click(screen.getByRole("button", { name: copy.publishVersion }));

    await waitFor(() => expect(mocks.saveGoalAssetDraft).toHaveBeenCalled());
    expect(mocks.saveGoalAssetDraft.mock.calls.at(-1)).toEqual([
      "goal-1",
      "first",
      expect.objectContaining({ workspaceId: "workspace-1" }),
    ]);
    expect(mocks.saveGoalAssetDraft).toHaveBeenCalledTimes(1);
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
  it("opens Markdown documents directly in MDXEditor", async () => {
    const markdown = asset(
      "guide",
      "Research guide",
      "# Guide\n\nUse **official sources**.",
    );
    markdown.versions[0]!.mimeType = "text/markdown";
    markdown.versions[0]!.originalFilename = "guide.md";
    renderWorkbench([markdown], "/goals/goal-1?section=workbench&asset=guide");

    await screen.findByRole("textbox", { name: copy.documentContent });
    expect(screen.queryByRole("button", { name: copy.previewMode })).not.toBeInTheDocument();
  });

  it("edits CSV cells through the shared draft and version lifecycle", async () => {
    const csv = asset(
      "sources",
      "Sources",
      [
        "name,official_url,note",
        'JKU,https://www.jku.at/,"Agent, tool use, and safety"',
        "Aarhus,https://phd.tech.au.dk/,Adaptive AI",
      ].join("\n"),
      1,
      "file",
    );
    csv.versions[0]!.mimeType = "text/csv";
    csv.versions[0]!.originalFilename = "sources.csv";
    renderWorkbench([csv], "/goals/goal-1?section=workbench&asset=sources");

    const spreadsheet = document.querySelector('[data-asset-canvas="spreadsheet-editor"]');
    expect(spreadsheet).not.toBeNull();
    expect(spreadsheet).toHaveAttribute("data-asset-canvas-mode", "edit");
    expect(screen.queryByRole("button", { name: copy.previewMode })).not.toBeInTheDocument();
    await userEvent.click(within(spreadsheet as HTMLElement).getByRole("button", { name: "Update first note" }));
    await waitFor(() => expect(mocks.saveGoalAssetDraft).toHaveBeenCalled(), { timeout: 1_500 });
    const latestCall = mocks.saveGoalAssetDraft.mock.calls.at(-1) as unknown as [string, string, { content: string }];
    expect(latestCall[2].content).toContain('"Updated, quoted note"');
  });

  it("opens structured data tables in the shared spreadsheet canvas", async () => {
    const dataTable = asset("tracker", "Application tracker", {
      schemaVersion: 1,
      columns: [{ id: "status", label: "Status", type: "text" }],
      rows: [{ id: "row-1", values: { status: "Ready" } }],
    }, 1, "data_table");
    renderWorkbench([dataTable], "/goals/goal-1?section=workbench&asset=tracker");

    const canvas = document.querySelector('[data-asset-canvas="spreadsheet-editor"]');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("data-asset-canvas-mode", "edit");
    expect(screen.queryByRole("button", { name: copy.previewMode })).not.toBeInTheDocument();
  });

  it("routes CSV content directly to the shared Univer editor even when persisted as a document", () => {
    const csv = asset("legacy-csv", "Legacy tracker", "Name,Status\nJane,Ready", 1, "document", { mimeType: "text/csv", originalFilename: "tracker.csv" });
    renderWorkbench([csv], "/goals/goal-1?section=workbench&asset=legacy-csv");

    const editor = document.querySelector('[data-asset-canvas="spreadsheet-editor"]');
    expect(editor).not.toBeNull();
    expect(editor).toHaveAttribute("data-asset-canvas-mode", "edit");
    expect(editor).toHaveTextContent("1 rows · 2 columns");
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
            root: {
              type: "Stack",
              props: { gap: "md" },
              children: ["summary", "risk"],
            },
            summary: {
              type: "ResultSummary",
              props: { text: "日照＋临沂沂蒙山最适合本次旅行。" },
            },
            risk: {
              type: "Alert",
              props: {
                title: "Travel constraint",
                description: "Avoid the holiday peak.",
              },
            },
          },
        },
        artifactRefs: [],
      },
      1,
      "structured_result",
    );
    renderWorkbench(
      [structured],
      "/goals/goal-1?section=workbench&asset=structured",
    );

    expect(
      await screen.findByLabelText(copy.structuredResultContent),
    ).toHaveTextContent("日照＋临沂沂蒙山最适合本次旅行。");
    const canvas = screen.getByLabelText(copy.structuredResultContent);
    expect(canvas).toHaveAttribute("data-asset-canvas", "structured-result");
    expect(canvas).toHaveAttribute("data-asset-canvas-mode", "read");
    expect(canvas).toHaveClass("flex-1", "overflow-hidden");
    expect(canvas.children[1]).toHaveClass("overflow-y-auto");
    expect(screen.getByText("Travel constraint")).toBeInTheDocument();
    expect(screen.queryByText("chrona-json-render")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: copy.saveDraft }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.export }));
    await waitFor(() =>
      expect(screen.getByText(copy.exportMarkdown)).toBeInTheDocument(),
    );
    screen.getByText(copy.exportMarkdown).click();
    await waitFor(() =>
      expect(mocks.createGoalAssetJob).toHaveBeenCalledWith(
        "goal-1",
        "structured",
        expect.objectContaining({ format: "md" }),
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: copy.export }));
    await waitFor(() =>
      expect(screen.getByText(copy.exportPdf)).toBeInTheDocument(),
    );
    screen.getByText(copy.exportPdf).click();
    await waitFor(() =>
      expect(mocks.createGoalAssetJob).toHaveBeenCalledWith(
        "goal-1",
        "structured",
        expect.objectContaining({ format: "pdf" }),
      ),
    );
  });
});
