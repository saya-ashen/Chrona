import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { GoalListPage } from "./goal-list-page";
import { GoalWorkspacePage } from "./goal-workspace-page";
import { CreateGoalFromResultDialog } from "./create-goal-from-result-dialog";
import type { GoalArtifactData, GoalCopy, GoalData } from "../model/goal-types";
import type { AiRunProgressEvent, GenerateGoalReviewRequest } from "@chrona/contracts";

const {
  apiJsonMock,
  promoteTaskToGoalMock,
  createGoalWithFirstTaskMock,
  generateGoalReviewMock,
  uuidv4Mock,
  applyGoalReviewProposalMock,
  rejectGoalReviewProposalMock,
} = vi.hoisted(() => ({
  apiJsonMock: vi.fn(async () => ({ id: "workspace-default" })),
  promoteTaskToGoalMock: vi.fn(async () => ({ id: "goal-promoted" })),
  createGoalWithFirstTaskMock: vi.fn(async () => ({ goal: { id: "goal-created" }, taskId: "task-created" })),
  generateGoalReviewMock: vi.fn(async (_goalId?: string, _command?: GenerateGoalReviewRequest, _options?: { onProgress?: (event: AiRunProgressEvent) => void }) => ({ proposalId: "proposal-created", status: "Generating" })),
  applyGoalReviewProposalMock: vi.fn(async () => ({})),
  rejectGoalReviewProposalMock: vi.fn(async () => ({})),
  uuidv4Mock: vi.fn(() => "goal-idempotency-key"),
}));
vi.mock("uuid", () => ({ v4: uuidv4Mock }));
vi.mock("@shared/http", () => ({ apiJson: apiJsonMock }));
vi.mock("../browser-api", () => ({
  runGoalAction: vi.fn(async () => ({})),
  createGoalTask: vi.fn(async () => ({ taskId: "task-created", goal: {} })),
  createGoalWithFirstTask: createGoalWithFirstTaskMock,
  generateGoalReview: generateGoalReviewMock,
  applyGoalReviewProposal: applyGoalReviewProposalMock,
  rejectGoalReviewProposal: rejectGoalReviewProposalMock,
  promoteTaskToGoal: promoteTaskToGoalMock,
  updateGoalBrief: vi.fn(async () => ({})),
}));
vi.mock("@chrona/i18n/react", () => ({ useLocale: () => "en" }));

const copy: GoalCopy = {
  title: "Goals",
  subtitle: "Durable outcomes",
  emptyTitle: "No Goals yet",
  emptyDescription: "Create a Goal to start.",
  createGoal: "Create Goal",
  createGoalDescription: "Define a durable outcome",
  defineOutcome: "Define the long-term outcome",
  defineOutcomeDescription: "Set the durable result this Goal should reach.",
  goalOutcomePlaceholder: "Describe the durable outcome",
  goalDescriptionHelp: "This context is available to future bounded tasks.",
  startFirstTask: "Start with one bounded task",
  startFirstTaskDescription: "Create the first concrete step.",
  firstTaskLabel: "First bounded task",
  firstTaskPlaceholder: "Describe the first task",
  optional: "Optional",
  firstTaskOptionalHelp:
    "You can create the Goal now and add its first task later.",
  createGoalOnly: "Create Goal",
  createGoalAndTask: "Create Goal and first task",
  initialCriterionTitle: "Confirm the intended outcome",
  initialCriterionDescription:
    "Confirm that the Goal outcome has been achieved.",
  attentionGoalsDescription: "Goals that need a decision or intervention.",
  progressGoalsDescription: "Goals with work currently moving.",
  quietGoals: "No immediate action",
  currentGoals: "Current Goals",
  archivedGoals: "Archived Goals",
  archivedGoalsDescription:
    "Completed and stopped Goals retained for reference.",
  archivedGoalsEmpty: "No archived Goals",
  archivedGoalsEmptyDescription: "Completed and stopped Goals appear here.",
  archiveCardSummary: "Goal history and retained results remain available.",
  removeCriterion: "Remove criterion",
  addCriterion: "Add criterion",
  openGoal: "Open Goal",
  backToGoals: "All Goals",
  ongoingWorkspace: "Ongoing Workspace",
  outcomeArchive: "Archived Goals",
  archiveDescription: "Completed and stopped Goals retained for reference.",
  pendingInbox: "Review {count} inbox item(s)",
  workspaceDescription: "Bounded ongoing work",
  controlPlane: "Goal Control Plane",
  workbench: "Workbench",
  operationalBrief: "Operational brief",
  outcomeLabel: "Intended outcome",
  currentFocus: "Current focus",
  strategy: "Current strategy",
  constraints: "Constraints",
  editBrief: "Edit brief",
  saveBrief: "Save brief",
  saving: "Saving",
  briefDescription: "The durable definition behind the current queue.",
  currentFocusDescription: "One clear queue for current Goal work.",
  focusClear: "Focus queue clear",
  focusClearDescription: "No work currently needs attention.",
  completedShort: "completed",
  confirmedShort: "confirmed",
  scheduledShort: "scheduled",
  stable: "Stable and paused",
  stableDescription: "Goals without immediate attention",
  focusQueue: "Focus queue",
  needsYou: "Needs you",
  inProgress: "In progress",
  newResults: "New results",
  upNext: "Up next",
  composer: "Compose bounded work",
  expectedOutcome: "Expected outcome",
  expectedOutcomePlaceholder: "Observable result",
  generateReview: "Generate AI review",
  generatingReview: "Generating review proposal…",
  aiProgress: {
    queued: "Preparing AI review…",
    connecting: "Connecting to AI…",
    thinking: "AI is thinking…",
    responding: "AI is preparing the review…",
    using_tool: "AI is using a tool…",
    validating: "Validating the review…",
    saving: "Saving the review…",
    completed: "Review ready",
    failed: "Review generation failed",
  },
  aiToolEvent: "AI is using tool: {tool}",
  rejectProposal: "Reject proposal",
  proposalFailed: "Review generation failed",
  proposalPending: "Pending decision",
  proposalStale: "This item is stale",
  proposalSource: "Generated by a bounded read-only Task",
  proposalNoItems: "No review items are available",
  applyReviewItem: "Apply this item",
  createReviewTask: "Create suggested task",
  rejectReviewItem: "Reject this item",
  applyAllReview: "Apply all",
  rejectAllReview: "Reject all",
  reviewEvidenceCount: "{count} evidence reference(s)",
  reviewWarningCount: "{count} warning(s)",
  reviewItemCannotApply: "This item cannot be applied",
  proposalAccepted: "Applied",
  proposalRejected: "Rejected",
  proposalConverted: "Task created",
  proposalIgnored: "Ignored",
  actionPreview: "Action preview",
  createBoundedTaskPreview:
    "Create one bounded task with an automatic snapshot of accepted Goal results.",
  taskInspector: "Task inspector",
  returnToGoal: "Return to Goal",
  overview: "Overview",
  tasksSection: "Work",
  resultsAssets: "Results & Assets",
  history: "History",
  processResult: "Use in Goal",
  processResultDescription: "Retain accepted deliverables",
  addToWorkingSet: "Add to working set",
  retainAsAsset: "Retain as asset",
  linkCriterion: "Link criterion",
  noCriterion: "No criterion",
  processedResult: "Processed",
  confirmCriterion: "Confirm criterion",
  confirmCriterionDescription: "Confirm with evidence",
  criterionEvidenceNote: "Evidence note",
  applyReview: "Apply review",
  applyReviewDescription: "Review changes",
  initialPlanTitle: "Review AI initial plan",
  initialPlanDescription: "Confirm the suggested initial plan",
  reviewSummary: "Review conclusion",
  reviewTaskSuggestion: "Suggested task",
  proposedChange: "Proposed change",
  updateReviewField: "Update {field}",
  createTaskReviewItem: "Create task: {title}",
  resolveEvidenceReviewItem: "Close evidence gap: {title}",
  currentReviewValue: "Current",
  suggestedReviewValue: "Suggested change",
  reviewReason: "Why this suggestion",
  evidenceReferences: "Evidence references",
  reviewWarnings: "Warnings",
  outcome: "Outcome",
  primaryResult: "Final outcome",
  confirmedOutcome: "User-confirmed outcome",
  retainedDeliverable: "Outcome document",
  stoppedUnconfirmed: "Goal stopped, achievement not confirmed",
  stoppedWithResultsDescription:
    "{completed} task(s) completed and {results} accepted result(s) retained; the Goal was not achieved.",
  stoppedWithoutResultsDescription: "Goal stopped without a retained result.",
  stoppedAt: "Stopped {date}",
  stopReasonMissing: "No stop reason was recorded",
  completedBeforeStop: "Work completed before stopping",
  retainedResultsCount: "{count} retained task result(s)",
  retainedResultsDescription:
    "Accepted Task output, not a Goal achievement confirmation.",
  acceptedTaskResult: "Accepted task result",
  resultCompleted: "What this result completed",
  resultDidNotConfirm: "What this result did not confirm",
  criterionEvidenceSummary: "Goal criteria and evidence remain unconfirmed.",
  viewFullResult: "View full result",
  hideFullResult: "Hide full result",
  openSourceTask: "Open source task",
  retainedInWorkbench: "Retained in Workbench",
  openAsset: "Open asset",
  archiveStatus: "Archive status",
  goalStatus: "Goal status",
  completedTasks: "Completed tasks",
  confirmedCriteria: "Confirmed criteria",
  achievementEvidence: "Achievement evidence",
  achievementEvidenceCount: "{count} item(s)",
  whyNotAchieved: "Why this is not Achieved",
  whyNotAchievedDescription:
    "No Goal confirmation or criterion evidence exists.",
  noPrimaryResult: "No final result",
  successCriteria: "Success criteria",
  progress: "Progress",
  boundedTasks: "Bounded tasks",
  acceptedResults: "Accepted results",
  assets: "Goal assets",
  nextReview: "Next review",
  noReview: "No review",
  noTasks: "No tasks",
  noAssets: "No assets",
  noAcceptedResults: "No accepted results",
  sourceEvidence: "Source evidence",
  currentVersion: "Current version",
  provenance: "Provenance",
  provenanceUnchanged: "Original accepted artifact",
  sourceTask: "Source task",
  role: "Role",
  assetStatus: "Asset status",
  pause: "Pause Goal",
  resume: "Resume Goal",
  stop: "Stop pursuing",
  achieve: "Confirm achieved",
  startReview: "Start Goal review",
  addTask: "Add task",
  reviewTaskTitle: "Review Goal progress",
  reviewTaskDescription: "Review evidence and next actions",
  addTaskTitle: "Add bounded task",
  taskTitleLabel: "Task title",
  taskDescriptionLabel: "Task instructions",
  taskTitlePlaceholder: "Bounded work",
  taskDescriptionPlaceholder: "Context and outcome",
  createTask: "Create task",
  creatingTask: "Creating task",
  confirmAchievement: "Confirm achieved?",
  confirmAchievementDescription: "Task completion is not enough",
  confirmationLabel: "Confirmation",
  confirmationPlaceholder: "Evidence",
  evidenceLabel: "Evidence used for confirmation",
  evidenceDescription: "Select retained evidence",
  evidenceRequired: "Select evidence",
  confirmedBy: "Confirmed by",
  confirmationNote: "Achievement confirmation",
  cancel: "Cancel",
  confirming: "Confirming…",
  actionError: "Action failed",
  currentUser: "Current user",
  sourceRun: "Source run",
  evidenceCount: "{count} linked evidence item(s)",
  outcomeSummary: "Outcome summary",
  verifiedOutcome: "Verified outcome",
  supportingEvidence: "Supporting evidence",
  resultActions: "Result actions",
  technicalDetails: "Technical details",
  outcomeDocument: "Outcome document",
  copyDocument: "Copy document",
  status: {
    Draft: "Draft",
    Active: "Active",
    Paused: "Paused",
    Achieved: "Achieved",
    Stopped: "Stopped",
  },
  activity: {
    idle: "Idle",
    work_active: "Work active",
    review_due: "Review due",
  },
  attention: {
    none: "No attention",
    needs_input: "Needs input",
    blocked: "Blocked",
    failed: "Failed",
  },
  nextAction: {
    none: "No action",
    review_criteria: "Review criteria",
    review: "Review",
    resolve_attention: "Resolve",
    continue_work: "Continue work",
    resume: "Resume",
    confirm_outcome: "Confirm outcome",
  },
  taskGroups: {
    attention: "Needs attention",
    active: "Active",
    planned: "Planned",
    completed: "Completed",
  },
  taskStatus: { Completed: "Completed", Ready: "Ready" },
  assetRoles: { Evidence: "Evidence", PrimaryOutcome: "Primary outcome" },
  assetStatuses: { Approved: "Approved" },
  criteriaProgress: "{completed} of {total} confirmed",
  taskProgress: "{completed} of {total} tasks completed",
  achievedAt: "Achieved",
  acceptedAt: "Accepted",
  immutableResult: "Immutable accepted result",
  openTask: "Open task",
  open: "Open",
  copy: "Copy",
  copied: "Copied",
  download: "Download",
  showDetails: "Details",
  hideDetails: "Collapse",
  createFromResult: "Create Goal and continue",
  createFromResultTitle: "Continue as Goal",
  createFromResultDescription: "Preview promotion",
  goalTitleLabel: "Goal",
  goalDescriptionLabel: "Additional information (optional)",
  goalDescriptionPlaceholder: "Add context, scope, constraints, or preferences",
  criterionLabel: "Success criterion",
  criterionPlaceholder: "Confirm outcome",
  selectedAssets: "Selected assets",
  selectedAssetsRequired: "Select an asset",
  proposedFollowUp: "Proposed follow-up",
  proposedFollowUpDescription: "Create bounded work",
  createAndContinue: "Create Goal and continue",
  creatingGoal: "Creating",
  promotionError: "Promotion failed",
  suggestedCriterion: "System suggested",
  suggestedGoalName: "Suggested Goal name",
  suggestedGoalNameDescription: "Copied from the promoted Task",
  renameSuggestedGoal: "Rename suggested Goal",
  renameGoal: "Rename",
  assetWorkbench: {
    title: "Assets and result Inbox",
    description: "Durable Goal assets",
    readyTitle: "Goal knowledge is ready",
    readyDescription: "{count} assets available automatically",
    inboxActionTitle: "{count} results need review",
    inboxActionDescription: "Review before later Tasks use them",
    draftActionTitle: "{count} unpublished Drafts",
    draftActionDescription: "Drafts are excluded until published",
    reviewInbox: "Review Inbox",
    continueEditing: "Continue editing",
    descriptionLabel: "Description",
    purpose: "Purpose",
    futureTaskImpact: "Future Task availability",
    activeVersionImpact:
      "Available to new Tasks; existing Tasks keep captured versions.",
    draftVersionImpact: "Draft excluded until published.",
    roleWorkingDocument: "Working document",
    roleReference: "Reference",
    roleEvidence: "Evidence",
    roleSubmission: "Submission",
    roleTemplate: "Template",
    usageHistory: "Read history",
    usageHistoryEmpty: "No reads",
    usageHistoryEntry: "Read v{version} for {task}",
    library: "Library",
    inbox: "Inbox",
    allAssets: "All assets",
    noAssets: "No matching Goal assets",
    noAssetsDescription: "Review Inbox candidates",
    inboxClear: "Inbox clear",
    inboxClearDescription: "Accepted Results appear here",
    searchAssets: "Search assets",
    allTypes: "All types",
    documents: "Documents",
    forms: "Forms",
    pages: "Pages",
    files: "Files",
    structuredResults: "Structured results",
    structuredResultDescription: "Validated read-only result",
    invalidStructuredResult: "Invalid structured result",
    structuredResultContent: "Structured result content",
    allSources: "All sources",
    allStatuses: "All statuses",
    draft: "Draft",
    processing: "Processing",
    failed: "Failed",
    archived: "Archived",
    archivedEmpty: "No archived assets",
    archivedEmptyDescription: "Archived assets appear here.",
    recentlyUpdated: "Recently updated",
    oldestUpdated: "Oldest updated",
    name: "Name",
    recent: "Recent",
    assetCount: "assets",
    filters: "Filters",
    activeFilters: "Active filters",
    clearFilters: "Clear",
    ruleBasedMatch: "Rule-based name match",
    sourceTask: "Source Task",
    changeSummary: "Change summary",
    assetDestination: "Asset destination",
    createNewAsset: "Create a new asset",
    appendToAsset: "Update {asset} as a new version",
    noRuleBasedMatch: "No rule-based name match",
    ruleBasedMatchDescription: "Names overlap for the same asset type",
    noRuleBasedMatchDescription: "No same-type asset name overlaps",
    candidateFromAcceptedResult:
      "Candidate derived from accepted result “{result}”",
    createAsset: "Create new asset",
    appendVersion: "Create new version",
    rejectCandidate: "Reject",
    candidateGroupTitle: "Candidates from {task}",
    candidateGroupDescription:
      "{count} related deliverables share this source Task",
    candidateProgress: "{current} of {total} in this Task",
    createAssetDescription: "Creates a separate formal Goal asset",
    updateVersionDescription: "Creates v{version} + 1 for {asset}",
    hideDetails: "Hide source content",
    candidateUpdateFailed: "Candidate update failed",
    pageSafetyWarning: "Generated Page runs in an isolated frame.",
    genericFileDescription:
      "Generic files preserve immutable source provenance.",
    formSchema: "Form definition JSON",
    fillMode: "Fill",
    designMode: "Design",
    submitForm: "Submit response",
    requiredField: "Required",
    invalidFormDefinition: "Invalid Form definition",
    formSubmissionStored: "Form submission stored",
    submissions: "Submissions",
    noSubmissions: "No submissions",
    downloadSubmission: "Download submission",
    documentContent: "Document content",
    documentViewMode: "Document view",
    previewMode: "Preview",
    editMode: "Edit source",
    markdownSourceMode: "Markdown source",
    markdownRichMode: "Rich text",
    csvPreview: "CSV preview",
    draftAutosaved: "Draft autosaved",
    draftSaved: "Draft saved",
    publishVersion: "Publish version",
    newFormalVersionCreated: "New formal version created",
    manualEditSummary: "Manual Workbench edit",
    actionFailed: "Action failed",
    titleLabel: "Title",
    renamed: "Renamed",
    save: "Save",
    asset: "Asset",
    type: "Type",
    source: "Source",
    formalVersion: "Formal version",
    saveDraft: "Save draft",
    downloadSource: "Download source",
    export: "Export",
    exportReady: "Export ready",
    exportMarkdown: "Markdown",
    exportPdf: "PDF",
    exportJson: "JSON",
    restore: "Restore",
    assetRestored: "Asset restored",
    assetArchived: "Asset archived",
    versions: "Versions",
    ai: "AI",
    formalVersionFallback: "Formal version",
    recoveredVersion: "Recovered v{version} as a new version",
    recover: "Recover",
    modificationRequest: "Modification request",
    modificationPlaceholder: "Describe a bounded change",
    expectedModifiedOutcome: "A reviewed new version of {asset}",
    versionBoundTaskCreated: "Version-bound Task created",
    assetsNavigation: "Goal assets",
    assetDetails: "Details",
    collapseAssets: "Collapse assets",
    collapseDetails: "Collapse details",
    openAssets: "Browse assets",
    openDetails: "Versions and details",
    currentVersion: "Current version",
    draftAvailable: "Draft available",
    noDraft: "No draft",
    draftChangedAt: "Last draft change: {time}",
    discardDraft: "Discard changes",
    discardDraftTitle: "Discard draft changes?",
    discardDraftDescription: "Discard the autosaved draft.",
    discardDraftCancel: "Keep editing",
    draftDiscarded: "Draft changes discarded",
    originalFilename: "Original filename",
    mimeType: "MIME type",
    updated: "Updated",
    archiveAsset: "Archive asset",
    restoreAsset: "Restore asset",
    aiModificationDescription:
      "Creates a bounded Task based on this exact version.",
    overview: "Overview",
    activity: "Activity",
    cancel: "Cancel",
    editAssetInfo: "Edit asset information",
    editAssetInfoDescription: "Edit name and description",
    moreAssetActions: "More asset actions",
    modifyWithAi: "Modify with AI",
    newTasksUseCurrentVersion: "New Tasks use this version.",
    existingTasksKeepVersion: "Existing Tasks keep captured versions.",
    useTaskDescription: "Use {asset} v{version}",
    taskTitleLabel: "Task title",
    aiModificationDialogDescription: "Modify {asset} v{version}",
    recordVerification: "Record verification",
    updateVerification: "Update verification",
    recordVerificationDescription: "Record verification details",
    restoreAsNewVersion: "Restore as new version",
    createAiTask: "Create AI Task",
    provenanceDescription: "{kind} · provenance",
    closeAssetWorkspace: "Close asset workspace",
    documentKind: "Document",
    formKind: "Form",
    pageKind: "Page",
    fileKind: "File",
    manualSource: "Manual",
    aiTaskSource: "AI Task",
    inboxSource: "Inbox",
    restoredSource: "Restored",
    importedSource: "Imported",
    aiRecommendation: "AI recommendation",
    generateAiRecommendation: "Generate AI recommendation",
    generatingAiRecommendation: "Generating recommendation…",
    aiRecommendationFailed: "AI recommendation failed",
    applyAiRecommendation: "Apply AI recommendation",
    aiDecisionCreate: "Create a new asset",
    aiDecisionAppend: "Append to {asset}",
    aiDecisionSeparate: "Keep as a separate asset",
    rationale: "Rationale",
    differenceSummaryLabel: "Difference summary",
    certainty: "Certainty: {certainty}",
    certaintyLow: "low",
    certaintyMedium: "medium",
    certaintyHigh: "high",
    evidence: "Evidence",
    counterEvidence: "Counter-evidence",
    aiSource: "Generated by {provider}{model}",
    proposalStale: "This recommendation is stale.",
    proposalApplied: "AI recommendation applied",
    dataTables: "Data tables",
    dataTableSummary: "{rows} rows · {columns} columns",
    resultFromTask: "Accepted result from {task}",
    missingAssetDescription: "No description",
    reviewDueSoon: "Review due soon",
    reviewOverdue: "Review overdue",
    reviewCurrent: "Current",
    freshness: "Freshness",
    lastVerified: "Last verified",
    nextReview: "Next review",
    noReview: "No review",
    verifyNow: "Verify",
    reviewSummary: "Review summary",
    reviewSummaryPlaceholder: "Summary",
    markVerified: "Mark verified",
    reviewSaved: "Review saved",
    useForTask: "Use for Task",
    useTaskTitle: "Create Task",
    taskInstruction: "Instructions",
    taskInstructionPlaceholder: "Instructions",
    expectedOutcomeLabel: "Expected outcome",
    createTask: "Create Task",
    useTaskCreated: "Task created",
    tableViewMode: "View",
    tableEditMode: "Edit",
    addRow: "Add row",
    deleteRow: "Delete row",
    dataTableInvalid: "Invalid data table",
    dataTableKind: "Data table",
  },
};

const artifact: GoalArtifactData = {
  id: "artifact-1",
  taskId: "task-1",
  runId: "run-1",
  title: "Final result",
  type: "summary",
  uri: "chrona://result",
  contentPreview: "Final immutable outcome",
  createdAt: "2026-07-01T00:00:00.000Z",
  operations: {
    canOpen: true,
    canCopy: true,
    canDownload: false,
    downloadHref: null,
  },
};

const baseGoal: GoalData = {
  id: "goal-1",
  workspaceId: "ws-1",
  title: "Reach durable outcome",
  titleSource: "user",
  titleRenameNoticeSeenAt: null,
  description: "Across bounded tasks",
  status: "Active",
  mode: "workspace",
  nextReviewAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  achievedAt: null,
  stoppedAt: null,
  successCriteria: [
    {
      id: "criterion",
      kind: "user_confirmed",
      description: "User confirms outcome",
      satisfied: false,
      confirmedAt: null,
      proposalStatus: "confirmed",
    },
  ],
  projection: {
    lifecycle: "Active",
    activity: "idle",
    attention: "none",
    nextAction: "confirm_outcome",
    completedTaskCount: 0,
    totalTaskCount: 0,
    criteriaSatisfiedCount: 0,
    criteriaTotalCount: 1,
  },
  primaryAction: { kind: "confirm_outcome", taskId: null },
  outcome: {
    primaryResult: null,
    confirmation: null,
    criteria: [
      {
        id: "criterion",
        kind: "user_confirmed",
        description: "User confirms outcome",
        satisfied: false,
        confirmedAt: null,
        proposalStatus: "confirmed",
        evidenceArtifactIds: [],
      },
    ],
  },
  taskGroups: { attention: [], active: [], planned: [], completed: [] },
  tasks: [],
  acceptedResults: [],
  workbench: {
    pendingInboxCount: 0,
    brief: {
      outcome: "Reach durable outcome",
      currentFocus: "Confirm next bounded step",
      strategy: "Use accepted evidence",
      constraints: ["Retain provenance"],
    },
    briefRevisionCount: 1,
    focus: { needsYou: [], inProgress: [], newResults: [], upNext: [] },
  },
  reviewProposals: [],
  assets: [
    {
      id: "asset-1",
      label: "Outcome evidence",
      role: "Evidence",
      status: "Approved",
      createdAt: artifact.createdAt,
      updatedAt: artifact.createdAt,
      currentVersion: 1,
      sourceArtifact: artifact,
      currentArtifact: artifact,
      provenance: {
        sourceTaskId: "task-1",
        sourceRunId: "run-1",
        sourceArtifactId: artifact.id,
        currentArtifactId: artifact.id,
        unchanged: true,
      },
    },
  ],
  activity: [],
};

function renderInRouter(node: React.ReactNode, initialEntry = "/en/goals") {
  const router = createMemoryRouter([{ path: "*", element: node }], {
    initialEntries: [initialEntry],
  });
  return { ...render(<RouterProvider router={router} />), router };
}

describe("Goal pages", () => {
  afterEach(() => cleanup());
  it("shows the empty list state", () => {
    renderInRouter(<GoalListPage goals={[]} copy={copy} />);
    expect(screen.getByText("No Goals yet")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Goals" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Long-horizon outcomes")).not.toBeInTheDocument();
  });

  it("creates a Goal with a library-generated idempotency key", async () => {
    renderInRouter(<GoalListPage goals={[]} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Goal" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Goal"), {
      target: { value: "Plan a two-week trip to Japan" },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Additional information (optional)"),
      {
        target: { value: "Travel in October with a total budget of $5,000" },
      },
    );
    fireEvent.change(within(dialog).getByLabelText("First bounded task"), {
      target: { value: "Draft the itinerary and budget" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Create Goal and first task",
      }),
    );

    await waitFor(() =>
      expect(createGoalWithFirstTaskMock).toHaveBeenCalledWith({
        workspaceId: "workspace-default",
        title: "Plan a two-week trip to Japan",
        firstTaskTitle: "Draft the itinerary and budget",
        additionalContext: "Travel in October with a total budget of $5,000",
        priority: "Medium",
        idempotencyKey: "goal-idempotency-key",
      }),
    );
    expect(uuidv4Mock).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(generateGoalReviewMock).toHaveBeenCalledWith("goal-created", {
        idempotencyKey: "goal-idempotency-key",
        mode: "initial",
      }, expect.anything()),
    );
  });

  it("shows lifecycle, attention, and one primary next action", () => {
    const goal: GoalData = {
      ...baseGoal,
      projection: {
        ...baseGoal.projection,
        activity: "review_due",
        attention: "needs_input",
        nextAction: "resolve_attention",
      },
    };
    renderInRouter(<GoalListPage goals={[goal]} copy={copy} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Needs input")).toBeInTheDocument();
    expect(screen.getByText("Resolve")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Goal/ })).toHaveAttribute(
      "href",
      "/en/goals/goal-1",
    );
  });

  it("opens an archived Goal by clicking its card without a view-result button", async () => {
    const archivedGoal: GoalData = {
      ...baseGoal,
      id: "goal-archive",
      title: "Archived outcome",
      status: "Stopped",
      mode: "archive",
      stoppedAt: "2026-07-02T00:00:00.000Z",
      projection: {
        ...baseGoal.projection,
        lifecycle: "Stopped",
        nextAction: "none",
      },
      primaryAction: { kind: "none", taskId: null },
    };
    const { router } = renderInRouter(
      <GoalListPage goals={[baseGoal, archivedGoal]} copy={copy} />,
    );

    expect(screen.getByRole("tab", { name: /Current Goals/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Reach durable outcome")).toBeInTheDocument();
    expect(screen.queryByText("Archived outcome")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: /Archived Goals/ }));
    expect(
      await screen.findByText(copy.archivedGoalsDescription),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe("?goalView=archived");
    expect(screen.getByText("Archived outcome")).toBeInTheDocument();
    expect(screen.queryByText("Reach durable outcome")).toBeNull();
    expect(screen.queryByRole("button", { name: /View outcome/i })).toBeNull();

    fireEvent.click(screen.getByRole("heading", { name: "Archived outcome" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/en/goals/goal-archive"),
    );
  });

  it("puts the final outcome before archive details and exposes provenance", () => {
    const acceptedResult = {
      runId: "run-1",
      acceptedAt: artifact.createdAt,
      completedAt: artifact.createdAt,
      summary: "Accepted result summary",
      artifacts: [artifact],
    };
    const completedTask = {
      id: "task-1",
      title: "Bounded step",
      description: null,
      status: "Completed",
      priority: "High",
      kind: "single",
      dueAt: null,
      updatedAt: artifact.createdAt,
      attention: null,
      group: "completed" as const,
      acceptedResult,
    };
    const goal: GoalData = {
      ...baseGoal,
      status: "Achieved",
      mode: "archive",
      achievedAt: artifact.createdAt,
      projection: {
        ...baseGoal.projection,
        lifecycle: "Achieved",
        nextAction: "none",
        completedTaskCount: 1,
        totalTaskCount: 1,
        criteriaSatisfiedCount: 1,
      },
      primaryAction: { kind: "none", taskId: null },
      outcome: {
        primaryResult: artifact,
        confirmation: {
          note: "Offer accepted",
          actorType: "user",
          actorId: "acceptance-user",
          confirmedAt: artifact.createdAt,
          evidenceArtifactIds: [artifact.id],
        },
        criteria: [
          {
            ...baseGoal.outcome.criteria[0],
            satisfied: true,
            confirmedAt: artifact.createdAt,
            evidenceArtifactIds: [artifact.id],
          },
        ],
      },
      tasks: [completedTask],
      taskGroups: {
        attention: [],
        active: [],
        planned: [],
        completed: [completedTask],
      },
      acceptedResults: [
        {
          ...acceptedResult,
          taskId: completedTask.id,
          taskTitle: completedTask.title,
        },
      ],
    };
    const router = createMemoryRouter(
      [{ path: "*", element: <GoalWorkspacePage goal={goal} copy={copy} /> }],
      { initialEntries: ["/en/goals/goal-1"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText("Final immutable outcome")).toBeInTheDocument();
    expect(screen.getByText("Offer accepted")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Achievement confirmation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Outcome document" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Outcome evidence")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy document" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Technical details").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByText("Bounded step")).toBeInTheDocument();
  });

  it("keeps a stopped Goal distinct from its retained task result", async () => {
    const acceptedResult = {
      runId: artifact.runId,
      acceptedAt: artifact.createdAt,
      completedAt: artifact.createdAt,
      summary: "Compared destinations and selected a preferred option.",
      artifacts: [artifact],
    };
    const completedTask = {
      id: artifact.taskId,
      title: "Select destination",
      description: null,
      status: "Completed",
      priority: "High",
      kind: "single",
      dueAt: null,
      updatedAt: artifact.createdAt,
      attention: null,
      group: "completed" as const,
      acceptedResult,
    };
    const stoppedGoal: GoalData = {
      ...baseGoal,
      status: "Stopped",
      mode: "archive",
      stoppedAt: "2026-07-02T00:00:00.000Z",
      projection: {
        ...baseGoal.projection,
        lifecycle: "Stopped",
        nextAction: "none",
        completedTaskCount: 1,
        totalTaskCount: 1,
      },
      primaryAction: { kind: "none", taskId: null },
      outcome: { ...baseGoal.outcome, primaryResult: artifact },
      tasks: [completedTask],
      taskGroups: {
        attention: [],
        active: [],
        planned: [],
        completed: [completedTask],
      },
      acceptedResults: [
        {
          ...acceptedResult,
          taskId: completedTask.id,
          taskTitle: completedTask.title,
        },
      ],
    };

    renderInRouter(
      <GoalWorkspacePage goal={stoppedGoal} copy={copy} />,
      "/en/goals/goal-1",
    );

    expect(
      screen.getByRole("heading", {
        name: "Goal stopped, achievement not confirmed",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Accepted task result")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Accepted Task output, not a Goal achievement confirmation.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Verified outcome")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Why this is not Achieved" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View full result" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open source task" }),
    ).toHaveAttribute("href", "/en/goals/goal-1/workbench/tasks/task-1");
    expect(
      screen.getByText("Technical details").closest("details"),
    ).not.toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "View full result" }));
    expect(
      screen.getAllByText(
        "Compared destinations and selected a preferred option.",
      ),
    ).toHaveLength(2);
  });

  it("explains a stopped Goal with no retained result", () => {
    const stoppedGoal: GoalData = {
      ...baseGoal,
      status: "Stopped",
      mode: "archive",
      stoppedAt: "2026-07-02T00:00:00.000Z",
      projection: {
        ...baseGoal.projection,
        lifecycle: "Stopped",
        nextAction: "none",
      },
      primaryAction: { kind: "none", taskId: null },
    };

    renderInRouter(
      <GoalWorkspacePage goal={stoppedGoal} copy={copy} />,
      "/en/goals/goal-1",
    );

    expect(
      screen.getByText("Goal stopped without a retained result."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 retained task result(s)")).toBeInTheDocument();
    expect(screen.queryByText("Accepted task result")).not.toBeInTheDocument();
    expect(screen.queryByText("Verified outcome")).not.toBeInTheDocument();
  });

  it("shows evidence-backed criterion counts without an aggregate percentage", () => {
    renderInRouter(
      <GoalWorkspacePage goal={baseGoal} copy={copy} />,
      "/en/goals/goal-1?section=criteria",
    );

    expect(screen.getByText("0 of 1 confirmed")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("opens deep-linked sections in a fixed workspace navigation", () => {
    renderInRouter(
      <GoalWorkspacePage goal={baseGoal} copy={copy} />,
      "/en/goals/goal-1?section=history",
    );

    expect(
      screen.getByRole("navigation", { name: "Goal Control Plane" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(
      screen.getByRole("heading", { name: copy.workspaceDescription }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-goal-section-scroll]")).toHaveClass(
      "overflow-y-auto",
    );
    expect(document.querySelector('[data-slot="page-frame"]')).toHaveClass(
      "overflow-y-hidden",
    );
  });

  it("shows the active Goal control plane and automatic-context composer", () => {
    const goal: GoalData = {
      ...baseGoal,
      primaryAction: { kind: "none", taskId: null },
      taskGroups: {
        ...baseGoal.taskGroups,
        attention: [
          {
            id: "attention-1",
            title: "Approve research statement",
            description: "Review before submission",
            status: "WaitingForApproval",
            priority: "Urgent",
            kind: "single",
            dueAt: null,
            updatedAt: artifact.createdAt,
            attention: "approval_required",
            group: "attention",
            acceptedResult: null,
          },
        ],
      },
      tasks: [],
    };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    expect(
      screen.getByText("Current focus", { selector: "h2" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirm next bounded step")).toBeInTheDocument();
    expect(
      screen.queryByText("Approved application package"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(
      screen.getByRole("dialog", { name: "Add bounded task" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Selected context")).not.toBeInTheDocument();
  });

  it("labels promotion-derived Goal content as system suggestions", () => {
    const goal: GoalData = {
      ...baseGoal,
      titleSource: "system",
      successCriteria: [
        {
          ...baseGoal.successCriteria[0]!,
          proposalStatus: "proposed",
        },
      ],
      outcome: {
        ...baseGoal.outcome,
        criteria: [
          {
            ...baseGoal.outcome.criteria[0]!,
            proposalStatus: "proposed",
          },
        ],
      },
    };

    renderInRouter(
      <GoalWorkspacePage goal={goal} copy={copy} />,
      "/en/goals/goal-1?section=criteria",
    );

    expect(screen.getByText(copy.suggestedCriterion)).toBeInTheDocument();
    expect(screen.getByText(copy.suggestedGoalName)).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: copy.renameSuggestedGoal }),
    ).toHaveValue(goal.title);
    expect(screen.queryByText(/AI proposed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI-generated Goal/i)).not.toBeInTheDocument();
  });

  it("requires confirmation and retained evidence before achievement", () => {
    const goal: GoalData = {
      ...baseGoal,
      outcome: {
        ...baseGoal.outcome,
        criteria: baseGoal.outcome.criteria.map((criterion) => ({
          ...criterion,
          satisfied: true,
          evidenceArtifactIds: [artifact.id],
        })),
      },
    };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Confirm achieved" })[0],
    );
    const confirmation = screen.getByRole("textbox", { name: "Confirmation" });
    const submit = screen
      .getAllByRole("button", { name: "Confirm achieved" })
      .at(-1)!;
    fireEvent.change(confirmation, {
      target: { value: "Outcome evidence confirmed" },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Final result/ }));
    expect(submit).toBeEnabled();
  });

  it("shows paused state with a reversible primary action", () => {
    const goal: GoalData = {
      ...baseGoal,
      status: "Paused",
      projection: { ...baseGoal.projection, lifecycle: "Paused", nextAction: "resume" },
      primaryAction: { kind: "resume", taskId: null },
    };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume Goal" })).toBeInTheDocument();
  });

  it("opens and retries the initial planning proposal from the creation deep link", async () => {
    generateGoalReviewMock.mockClear();
    const { router } = renderInRouter(<GoalWorkspacePage goal={baseGoal} copy={copy} />, "/en/goals/goal-1?review=initial");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review AI initial plan" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate AI review" }));
    await waitFor(() =>
      expect(generateGoalReviewMock).toHaveBeenCalledWith("goal-1", {
        idempotencyKey: "goal-idempotency-key",
        mode: "initial",
      }, expect.anything()),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("renders live AI review progress without exposing generated content", async () => {
    const deferred = Promise.withResolvers<{ proposalId: string; status: string }>();
    let onProgress: ((event: AiRunProgressEvent) => void) | undefined;
    generateGoalReviewMock.mockImplementationOnce(async (_goalId, _command, options) => {
      onProgress = options?.onProgress;
      return deferred.promise;
    });
    renderInRouter(<GoalWorkspacePage goal={baseGoal} copy={copy} />, "/en/goals/goal-1?review=initial");
    fireEvent.click(screen.getByRole("button", { name: "Generate AI review" }));
    await waitFor(() => expect(onProgress).toBeDefined());
    onProgress?.({ operationId: "goal-idempotency-key", feature: "goal.review", sequence: 1, occurredAt: new Date().toISOString(), phase: "connecting" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Connecting to AI…"));
    onProgress?.({ operationId: "goal-idempotency-key", feature: "goal.review", sequence: 2, occurredAt: new Date().toISOString(), phase: "thinking" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("AI is thinking…"));
    onProgress?.({ operationId: "goal-idempotency-key", feature: "goal.review", sequence: 3, occurredAt: new Date().toISOString(), phase: "using_tool", toolName: "goal_snapshot_read" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("AI is using tool: goal_snapshot_read"));
    deferred.resolve({ proposalId: "proposal-created", status: "Generating" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate AI review" })).toBeEnabled());
  });

  it("shows queued and live AI events immediately while retrying a failed review", async () => {
    const deferred = Promise.withResolvers<{ proposalId: string; status: string }>();
    let onProgress: ((event: AiRunProgressEvent) => void) | undefined;
    generateGoalReviewMock.mockImplementationOnce(async (_goalId, _command, options) => {
      onProgress = options?.onProgress;
      return deferred.promise;
    });
    const failedGoal: GoalData = {
      ...baseGoal,
      primaryAction: { kind: "review", taskId: null },
      projection: { ...baseGoal.projection, nextAction: "review" },
      reviewProposals: [{
        id: "proposal-failed",
        mode: "progress",
        status: "Failed",
        sourceTaskId: null,
        sourceRunId: null,
        sourceTask: null,
        inputSnapshotHash: "sha256:failed",
        schemaVersion: 1,
        providerName: "debug",
        modelName: null,
        summary: null,
        generationError: "internal provider detail",
        appliedAt: null,
        rejectedAt: null,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        items: [],
      }],
    };
    renderInRouter(<GoalWorkspacePage goal={failedGoal} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Goal review" }));
    expect(screen.queryByText("internal provider detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate AI review" }));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing AI review…");
    await waitFor(() => expect(onProgress).toBeDefined());
    onProgress?.({ operationId: "retry-operation", feature: "goal.review", sequence: 1, occurredAt: new Date().toISOString(), phase: "thinking" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("AI is thinking…"));
    onProgress?.({ operationId: "retry-operation", feature: "goal.review", sequence: 2, occurredAt: new Date().toISOString(), phase: "using_tool", toolName: "goal_snapshot_read" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("AI is using tool: goal_snapshot_read"));

    deferred.resolve({ proposalId: "proposal-failed", status: "Generating" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate AI review" })).toBeEnabled());
  });
  it("starts clean after the latest review was discarded instead of reviving an older failure", () => {
    const reviewProposals: GoalData["reviewProposals"] = [
      {
        id: "proposal-discarded",
        mode: "progress",
        status: "Rejected",
        sourceTaskId: "review-task-discarded",
        sourceRunId: "review-run-discarded",
        sourceTask: null,
        inputSnapshotHash: "sha256:discarded",
        schemaVersion: 1,
        providerName: "debug",
        modelName: null,
        summary: "Discarded review",
        generationError: null,
        appliedAt: null,
        rejectedAt: "2026-07-23T00:00:00.000Z",
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
        items: [],
      },
      {
        id: "proposal-old-failure",
        mode: "progress",
        status: "Failed",
        sourceTaskId: null,
        sourceRunId: null,
        sourceTask: null,
        inputSnapshotHash: "sha256:old-failure",
        schemaVersion: 1,
        providerName: "debug",
        modelName: null,
        summary: null,
        generationError: "old failure",
        appliedAt: null,
        rejectedAt: null,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        items: [],
      },
    ];
    const goal: GoalData = {
      ...baseGoal,
      primaryAction: { kind: "review", taskId: null },
      projection: { ...baseGoal.projection, nextAction: "review" },
      reviewProposals,
    };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Goal review" }));

    expect(screen.queryByText("Review generation failed")).not.toBeInTheDocument();
    expect(screen.getByText("Review conclusion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate AI review" })).toBeEnabled();
  });


  it("renders concise review cards with per-item and bulk decisions", async () => {
    applyGoalReviewProposalMock.mockClear();
    rejectGoalReviewProposalMock.mockClear();
    const goal: GoalData = {
      ...baseGoal,
      primaryAction: { kind: "review", taskId: null },
      projection: { ...baseGoal.projection, nextAction: "review" },
      reviewProposals: [
        {
          id: "proposal-1",
          mode: "progress",
          status: "Ready",
          sourceTaskId: "review-task-1",
          sourceRunId: "review-run-1",
          sourceTask: {
            id: "review-task-1",
            title: "Review Goal: Reach durable outcome",
            status: "Completed",
            latestRunId: "review-run-1",
            latestRun: {
              id: "review-run-1",
              status: "Completed",
              errorSummary: null,
            },
          },
          inputSnapshotHash: "sha256:snapshot",
          schemaVersion: 1,
          providerName: "debug",
          modelName: null,
          summary: "One focused change is ready for review.",
          generationError: null,
          appliedAt: null,
          rejectedAt: null,
          createdAt: "2026-07-22T00:00:00.000Z",
          updatedAt: "2026-07-22T00:00:00.000Z",
          items: [
            {
              id: "proposal-item-1",
              itemId: "current-focus",
              kind: "brief_field",
              payload: { field: "currentFocus", value: "Verify the next outcome" },
              rationale: "Accepted evidence supports a narrower next step.",
              evidenceRefs: [{ type: "artifact", id: "internal-artifact-id", label: "Actionable opportunity table" }],
              warnings: ["Verify the deadline on the official page."],
              dependencyHash: "sha256:dependency",
              decision: "Pending",
              decisionReason: null,
              appliedObjectType: null,
              appliedObjectId: null,
              decidedAt: null,
            },
            {
              id: "proposal-item-2",
              itemId: "evidence-gap",
              kind: "evidence_gap",
              payload: {
                criterionId: "criterion-1",
                title: "Verify the admissions path",
                description: "Confirm that the supervisor can admit candidates.",
                suggestedTask: {
                  title: "Verify admissions path",
                  description: "Check the official program and lab pages.",
                  expectedOutcome: "The application route is confirmed.",
                },
              },
              rationale: "The supervisor list needs an official admissions check.",
              evidenceRefs: [],
              warnings: [],
              dependencyHash: "sha256:evidence-gap",
              decision: "Pending",
              decisionReason: null,
              appliedObjectType: null,
              appliedObjectId: null,
              decidedAt: null,
            },
          ],
        },
      ],
    };
    renderInRouter(<GoalWorkspacePage goal={goal} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Goal review" }));

    expect(screen.getByText("Update Current focus", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("Close evidence gap: Verify the admissions path", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("Verify the next outcome")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Confirm next bounded step")).toBeInTheDocument();
    const rationaleSummary = screen.getByText("Why this suggestion · 1 evidence reference(s) · 1 warning(s)");
    expect(rationaleSummary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("internal-artifact-id")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply all" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject all" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create suggested task: Verify the admissions path" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Apply this item: Current focus" }));
    await waitFor(() => expect(applyGoalReviewProposalMock).toHaveBeenCalledWith("goal-1", "proposal-1", {
      idempotencyKey: "goal-idempotency-key",
      decisions: [{ itemId: "current-focus", action: "accept" }],
    }));
    fireEvent.click(screen.getByRole("button", { name: "Reject this item: Verify the admissions path" }));
    await waitFor(() => expect(applyGoalReviewProposalMock).toHaveBeenLastCalledWith("goal-1", "proposal-1", {
      idempotencyKey: "goal-idempotency-key",
      decisions: [{ itemId: "evidence-gap", action: "reject" }],
    }));
  });

  it("applies or rejects every pending review item without selection", async () => {
    applyGoalReviewProposalMock.mockClear();
    rejectGoalReviewProposalMock.mockClear();
    const proposalGoal: GoalData = {
      ...baseGoal,
      primaryAction: { kind: "review", taskId: null },
      projection: { ...baseGoal.projection, nextAction: "review" },
      reviewProposals: [{
        id: "proposal-bulk",
        mode: "progress",
        status: "Ready",
        sourceTaskId: "review-task-1",
        sourceRunId: "review-run-1",
        sourceTask: null,
        inputSnapshotHash: "sha256:snapshot",
        schemaVersion: 1,
        providerName: "debug",
        modelName: null,
        summary: "Ready.",
        generationError: null,
        appliedAt: null,
        rejectedAt: null,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        items: [{
          id: "proposal-item-bulk",
          itemId: "current-focus",
          kind: "brief_field",
          payload: { field: "currentFocus", value: "Submit applications" },
          rationale: "Research is complete.",
          evidenceRefs: [],
          warnings: [],
          dependencyHash: "sha256:dependency",
          decision: "Pending",
          decisionReason: null,
          appliedObjectType: null,
          appliedObjectId: null,
          decidedAt: null,
        }],
      }],
    };
    const first = renderInRouter(<GoalWorkspacePage goal={proposalGoal} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Goal review" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply all" }));
    await waitFor(() => expect(applyGoalReviewProposalMock).toHaveBeenCalledWith("goal-1", "proposal-bulk", {
      idempotencyKey: "goal-idempotency-key",
      decisions: [{ itemId: "current-focus", action: "accept" }],
    }));
    first.unmount();

    renderInRouter(<GoalWorkspacePage goal={proposalGoal} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Goal review" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    await waitFor(() => expect(rejectGoalReviewProposalMock).toHaveBeenCalledWith("goal-1", "proposal-bulk", {
      idempotencyKey: "goal-idempotency-key",
    }));
  });

  it("previews selected accepted assets and opens the promoted Goal", async () => {
    const { router } = renderInRouter(
      <CreateGoalFromResultDialog
        taskId="task-1"
        workspaceId="ws-1"
        acceptedRunId="run-1"
        taskTitle="Accepted task"
        taskDescription="Accepted result description"
        artifacts={[
          { id: "artifact-1", title: "Final result", type: "markdown" },
        ]}
        copy={copy}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create Goal and continue" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Final result")).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Goal and continue" }),
    );
    await waitFor(() =>
      expect(promoteTaskToGoalMock).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          workspaceId: "ws-1",
          acceptedRunId: "run-1",
          artifactIds: ["artifact-1"],
          title: "Accepted task",
        }),
      ),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/en/goals/goal-promoted"),
    );
  });
});
