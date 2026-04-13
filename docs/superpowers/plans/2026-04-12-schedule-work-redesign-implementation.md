# Schedule And Work Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `Schedule` into a clearer planning canvas and refocus `Work` into a high-contrast execution workbench where the next operator action is immediately obvious.

**Architecture:** Keep the current `Next.js` page routes and existing schedule/work query contracts, but reorganize the page-level component hierarchy around stronger primary surfaces. `Schedule` becomes `PlanningHeader + main canvas + action rail + week strip`; `Work` becomes `TaskShell + NextActionHero + LatestResultPanel + ExecutionStream + WorkInspector`, with old heavy side-rail semantics removed.

**Tech Stack:** `Next.js` App Router, `React 19`, `TypeScript`, `Tailwind CSS`, `Vitest`, `Testing Library`

---

## File Structure

### Files To Modify

- `src/components/schedule/schedule-page.tsx`: replace the current equal-weight section stack with a timeline-first canvas and segmented action rail.
- `src/components/schedule/__tests__/schedule-page.test.tsx`: update assertions from old section names to new hierarchy and rail behavior.
- `src/components/work/work-page-client.tsx`: rebuild the page composition around a dominant next-action surface.
- `src/components/work/__tests__/work-page.test.tsx`: verify the new workbench reading order and dominant action behavior.

### Files To Create

- `src/components/schedule/planning-header.tsx`: thin planning header with date focus, metrics, and view switch.
- `src/components/schedule/schedule-action-rail.tsx`: segmented `Queue / Risks / Proposals` rail.
- `src/components/work/task-shell.tsx`: compact task/run/schedule shell.
- `src/components/work/next-action-hero.tsx`: single dominant operator action surface.
- `src/components/work/latest-result-panel.tsx`: readable result-first panel.
- `src/components/work/work-inspector.tsx`: compact supporting context for plan, artifacts, tools, and task facts.

### Files To Remove Or Stop Using

- `src/components/work/run-side-panel.tsx`: old left rail structure should be replaced by `WorkInspector`.
- `src/components/work/task-plan-side-panel.tsx`: old right rail structure should be replaced by `WorkInspector`.

---

### Task 1: Rebuild Schedule As A Planning Canvas

**Files:**
- Create: `src/components/schedule/planning-header.tsx`
- Create: `src/components/schedule/schedule-action-rail.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Test: `src/components/schedule/__tests__/schedule-page.test.tsx`

- [ ] **Step 1: Write the failing Schedule layout test**

Add or replace the top-level Schedule assertions so they verify the new hierarchy instead of the old three-equal-panels layout.

```tsx
it("renders a planning header, dominant timeline canvas, and one active action rail topic", () => {
  render(
    <SchedulePage workspaceId="ws_1" selectedDay="2026-04-16" selectedTaskId="task_scheduled" data={buildBaseData()} />,
  );

  expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Scheduled Timeline" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Risks" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Queue" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Proposals" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Schedule Action Rail" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Unscheduled Queue" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the Schedule test and verify it fails**

Run: `bun run test -- src/components/schedule/__tests__/schedule-page.test.tsx`

Expected: FAIL because the current page still renders the old queue heading and has no action-rail tab semantics.

- [ ] **Step 3: Create `PlanningHeader`**

Create `src/components/schedule/planning-header.tsx`:

```tsx
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { LocalizedLink } from "@/components/localized-link";

type PlanningHeaderProps = {
  title: string;
  activeDayLabel: string;
  metrics: Array<{ label: string; value: number; tone?: "neutral" | "info" | "critical" }>;
  timelineHref: string;
  listHref: string;
  activeView: "timeline" | "list";
};

export function PlanningHeader({ title, activeDayLabel, metrics, timelineHref, listHref, activeView }: PlanningHeaderProps) {
  return (
    <section className="rounded-[28px] border border-border/60 bg-card/90 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{activeDayLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LocalizedLink href={timelineHref} className={buttonVariants({ variant: activeView === "timeline" ? "default" : "outline", size: "sm" })}>Timeline</LocalizedLink>
          <LocalizedLink href={listHref} className={buttonVariants({ variant: activeView === "list" ? "default" : "outline", size: "sm" })}>List</LocalizedLink>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {metrics.map((metric) => (
          <StatusBadge key={metric.label} tone={metric.tone}>{metric.label}: {metric.value}</StatusBadge>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `ScheduleActionRail`**

Create `src/components/schedule/schedule-action-rail.tsx`:

```tsx
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ScheduleRailMode = "queue" | "risks" | "proposals";

type ScheduleActionRailProps = {
  mode: ScheduleRailMode;
  onModeChange: (mode: ScheduleRailMode) => void;
  queue: React.ReactNode;
  risks: React.ReactNode;
  proposals: React.ReactNode;
};

export function ScheduleActionRail({ mode, onModeChange, queue, risks, proposals }: ScheduleActionRailProps) {
  const body = mode === "risks" ? risks : mode === "proposals" ? proposals : queue;

  return (
    <section aria-label="Schedule Action Rail" className="rounded-[28px] border border-border/60 bg-card p-4 shadow-sm">
      <div role="tablist" aria-label="Schedule rail topics" className="flex flex-wrap gap-2">
        {(["queue", "risks", "proposals"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => onModeChange(value)}
            className={cn(buttonVariants({ variant: mode === value ? "default" : "ghost", size: "sm" }), "rounded-full")}
          >
            {value === "queue" ? "Queue" : value === "risks" ? "Risks" : "Proposals"}
          </button>
        ))}
      </div>
      <div className="mt-4">{body}</div>
    </section>
  );
}
```

- [ ] **Step 5: Recompose `schedule-page.tsx` around the new hierarchy**

Update `src/components/schedule/schedule-page.tsx` so the main return tree follows this structure:

```tsx
return (
  <div className="space-y-5">
    <PlanningHeader
      title={copy.pageTitle}
      activeDayLabel={formatDayHeading(activeGroup?.date ?? new Date(), locale, copy)}
      metrics={[
        { label: copy.todayBlocks, value: activeGroup?.items.length ?? 0 },
        { label: copy.queueReady, value: viewData.summary.unscheduledCount, tone: viewData.summary.unscheduledCount > 0 ? "info" : "neutral" },
        { label: copy.needsAttention, value: viewData.summary.riskCount, tone: viewData.summary.riskCount > 0 ? "critical" : "neutral" },
        { label: copy.aiProposalsMetric, value: viewData.summary.proposalCount, tone: viewData.summary.proposalCount > 0 ? "info" : "neutral" },
      ]}
      timelineHref={buildScheduleViewHref(activeDay, "timeline", activeSelectedTaskId)}
      listHref={buildScheduleViewHref(activeDay, "list", activeSelectedTaskId)}
      activeView={activeView}
    />

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_360px] xl:items-start">
      <SurfaceCard variant="highlight" className="rounded-[32px] border-border/70 bg-slate-950 text-slate-50 shadow-xl">
        {activeView === "timeline" ? (
          <DayTimeline
            items={activeGroup?.items ?? []}
            dayDate={activeGroup?.date ?? new Date()}
            selectedDay={activeDay}
            selectedTaskId={selectedTaskId}
            draggedItem={draggedItem}
            runtimeAdapters={data.runtimeAdapters}
            defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
            isPending={isPending}
            onScheduleDrop={handleScheduleDrop}
            onCreateTaskBlock={handleCreateTaskBlock}
            onScheduledDragStart={handleScheduledDragStart}
            onDragEnd={handleQueueDragEnd}
          />
        ) : (
          <ScheduleTaskList
            items={viewData.listItems}
            runtimeAdapters={data.runtimeAdapters}
            defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
            onSaveTaskConfigAction={handleTaskConfigSave}
            isPending={isPending}
          />
        )}
      </SurfaceCard>

      <ScheduleActionRail
        mode={secondaryView}
        onModeChange={setSecondaryView}
        queue={(
          <div className="space-y-3">
            {viewData.unscheduled.length === 0 ? <EmptyState>{copy.noUnscheduledWork}</EmptyState> : viewData.unscheduled.map((item) => (
              <QueueCard
                key={item.taskId}
                item={item}
                runtimeAdapters={data.runtimeAdapters}
                defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                isPending={isPending}
                isDragging={draggedTask?.kind === "queue" && draggedTask.taskId === item.taskId}
                isExpanded={expandedQueueTaskIds.includes(item.taskId)}
                onToggle={() => toggleQueueCard(item.taskId)}
                onMutatedAction={refreshProjection}
                onSaveTaskConfigAction={handleTaskConfigSave}
                onDragStart={handleQueueDragStart}
                onDragEnd={handleQueueDragEnd}
              />
            ))}
          </div>
        )}
        risks={(
          <div className="space-y-3">
            {viewData.risks.length === 0 ? <EmptyState>{copy.noScheduleRisks}</EmptyState> : viewData.risks.map((item) => <RiskCard key={item.taskId} item={item} />)}
          </div>
        )}
        proposals={(
          <div className="space-y-3">
            {viewData.proposals.length === 0 ? <EmptyState>{copy.aiProposalsCompactEmpty}</EmptyState> : viewData.proposals.map((proposal) => (
              <ProposalCard key={proposal.proposalId} proposal={proposal} isPending={isPending} onAccept={handleAcceptProposal} onReject={handleRejectProposal} />
            ))}
          </div>
        )}
      />
    </div>

    <SurfaceCard>
      <SurfaceCardTitle>{copy.weekOverview}</SurfaceCardTitle>
      <WeekStrip groups={scheduledGroups} selectedDay={activeDay} />
    </SurfaceCard>
  </div>
);
```

Change `secondaryView` from `"week" | "risks" | "proposals"` to `"queue" | "risks" | "proposals"`. Keep the existing timeline/list logic and queue/proposal/risk card implementations, but move them behind the single rail. Keep `WeekStrip` visible below the main canvas instead of driving a separate mode.

- [ ] **Step 6: Run the Schedule tests until they pass**

Run: `bun run test -- src/components/schedule/__tests__/schedule-page.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the Schedule redesign slice**

```bash
git add src/components/schedule/planning-header.tsx src/components/schedule/schedule-action-rail.tsx src/components/schedule/schedule-page.tsx src/components/schedule/__tests__/schedule-page.test.tsx
git commit -m "feat: refocus schedule around the planning canvas"
```

---

### Task 2: Rebuild Work Into A High-Contrast Workbench

**Files:**
- Create: `src/components/work/task-shell.tsx`
- Create: `src/components/work/next-action-hero.tsx`
- Create: `src/components/work/latest-result-panel.tsx`
- Create: `src/components/work/work-inspector.tsx`
- Modify: `src/components/work/work-page-client.tsx`
- Test: `src/components/work/__tests__/work-page.test.tsx`

- [ ] **Step 1: Write the failing Work hierarchy tests**

Replace the top-level layout assertions so they verify a dominant action-first workbench.

```tsx
it("renders task shell, next action hero, latest result, execution stream, and compact inspector in order", () => {
  const approvalState = {
    taskShell: {
      id: "task_1",
      workspaceId: "ws_1",
      title: "Write projection",
      runtimeModel: "gpt-5.4",
      prompt: null,
      status: "Blocked",
      priority: "High",
      dueAt: null,
      scheduledStartAt: "2026-04-16T09:00:00.000Z",
      scheduledEndAt: "2026-04-16T11:00:00.000Z",
      scheduleStatus: "AtRisk",
      blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
    },
    currentRun: { id: "run_1", status: "WaitingForApproval", pendingInputPrompt: "Need operator guidance" },
    currentIntervention: {
      kind: "approval",
      title: "Resolve approval",
      description: "Allow the agent to edit files.",
      whyNow: "A human decision is required before the next execution step can proceed.",
      actionLabel: "Approve / Reject / Edit",
      evidence: [{ label: "Pending approval", value: "Approve tool execution", tone: "warning" }],
      approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
    },
    latestOutput: {
      kind: "message",
      title: "Latest agent output",
      body: "The agent prepared a safe file edit plan.",
      timestamp: "2026-04-16T10:15:00.000Z",
      href: null,
      empty: false,
      sourceLabel: "Conversation output",
    },
    scheduleImpact: {
      status: "AtRisk",
      dueAt: null,
      scheduledStartAt: "2026-04-16T09:00:00.000Z",
      scheduledEndAt: "2026-04-16T11:00:00.000Z",
      summary: "Execution timing is slipping against the planned window.",
    },
    reliability: {
      refreshedAt: "2026-04-16T10:16:00.000Z",
      lastSyncedAt: "2026-04-16T10:15:00.000Z",
      lastUpdatedAt: "2026-04-16T10:15:00.000Z",
      syncStatus: "healthy",
      isStale: false,
      stuckFor: "1m",
      stopReason: "Approve / Reject / Edit and Approve",
    },
    closure: { resultAccepted: false, acceptedAt: null, isDone: false, doneAt: null, canAcceptResult: false, canMarkDone: false, canCreateFollowUp: false, canRetry: false, canReopen: false, latestFollowUp: null },
    taskPlan: { state: "ready", revision: "generated", generatedBy: "work-plan-agent", isMock: true, summary: "先澄清目标与背景，再执行首轮产出。", updatedAt: "2026-04-16T10:16:00.000Z", changeSummary: "已基于当前任务背景生成初始占位计划。", currentStepId: "execute-task", steps: [{ id: "execute-task", title: "推进首轮产出", objective: "推进当前执行并处理审批节点。", phase: "执行", status: "waiting_for_user", needsUserInput: true }] },
    workstreamItems: [],
    conversation: [{ id: "msg_agent_1", role: "assistant", content: "I need approval before editing files.", runtimeTs: "2026-04-16T10:13:00.000Z" }],
    inspector: { approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }], artifacts: [], toolCalls: [] },
  } as const;

  render(<WorkPageClient initialData={approvalState} />);

  expect(screen.getByRole("heading", { name: "Write projection" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Current Next Action" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Latest Result" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Execution Stream" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Inspector" })).toBeInTheDocument();
  expect(screen.queryByText("待确认卡")).not.toBeInTheDocument();
});
```

Add state-based assertions such as:

```tsx
expect(screen.getByRole("button", { name: "批准" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
expect(screen.getByText("A human decision is required before the next execution step can proceed.")).toBeInTheDocument();
```

- [ ] **Step 2: Run the Work tests and verify they fail**

Run: `bun run test -- src/components/work/__tests__/work-page.test.tsx`

Expected: FAIL because the page still renders the old center stack and dual side rails.

- [ ] **Step 3: Create `TaskShell`**

Create `src/components/work/task-shell.tsx`:

```tsx
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { LocalizedLink } from "@/components/localized-link";

type TaskShellProps = {
  title: string;
  taskStatus: string;
  runStatus: string;
  scheduleStatus: string;
  blocker: string;
  taskHref: string;
  scheduleHref: string;
};

export function TaskShell({ title, taskStatus, runStatus, scheduleStatus, blocker, taskHref, scheduleHref }: TaskShellProps) {
  return (
    <section className="rounded-[30px] border border-border/70 bg-card/95 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="flex flex-wrap gap-2">
            <StatusBadge>{taskStatus}</StatusBadge>
            <StatusBadge tone="info">{runStatus}</StatusBadge>
            <StatusBadge tone={scheduleStatus.includes("Risk") || scheduleStatus.includes("Overdue") ? "warning" : "neutral"}>{scheduleStatus}</StatusBadge>
          </div>
          <p className="text-sm text-muted-foreground">{blocker}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LocalizedLink href={scheduleHref} className={buttonVariants({ variant: "outline", size: "sm" })}>打开日程</LocalizedLink>
          <LocalizedLink href={taskHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>查看任务详情</LocalizedLink>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `NextActionHero`, `LatestResultPanel`, and `WorkInspector`**

Create `src/components/work/next-action-hero.tsx`:

```tsx
type NextActionHeroProps = {
  title: string;
  description: string;
  statusLine: string;
  tone?: "info" | "warning" | "critical" | "success";
  content: React.ReactNode;
};

export function NextActionHero({ title, description, statusLine, tone = "info", content }: NextActionHeroProps) {
  return (
    <section className="rounded-[32px] border border-border/70 bg-slate-950 p-6 text-slate-50 shadow-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">Current Next Action</p>
      <div className="mt-3 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-3xl text-sm text-slate-300">{description}</p>
        <p className="text-xs text-slate-400">{statusLine}</p>
      </div>
      <div className="mt-5">{content}</div>
    </section>
  );
}
```

Create `src/components/work/latest-result-panel.tsx`:

```tsx
import { StatusBadge } from "@/components/ui/status-badge";

export function LatestResultPanel({ title, body, sourceLabel, updatedAt, actions }: { title: string; body: string; sourceLabel: string; updatedAt?: string | null; actions?: React.ReactNode; }) {
  return (
    <section className="rounded-[30px] border border-border/60 bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest Result</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">{title}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge>{sourceLabel}</StatusBadge>
          {updatedAt ? <span className="text-xs text-muted-foreground">Updated {updatedAt}</span> : null}
        </div>
      </div>
      <div className="mt-5 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{body}</div>
      {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
```

Create `src/components/work/work-inspector.tsx`:

```tsx
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sections = ["plan", "artifacts", "tools", "context"] as const;

export function WorkInspector({ plan, artifacts, tools, context }: { plan: React.ReactNode; artifacts: React.ReactNode; tools: React.ReactNode; context: React.ReactNode; }) {
  const [active, setActive] = useState<(typeof sections)[number]>("plan");
  const body = active === "artifacts" ? artifacts : active === "tools" ? tools : active === "context" ? context : plan;

  return (
    <section className="rounded-[28px] border border-border/60 bg-card/95 p-4 shadow-sm">
      <h2 className="text-base font-semibold tracking-tight">Inspector</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {sections.map((section) => (
          <button key={section} type="button" onClick={() => setActive(section)} className={cn(buttonVariants({ variant: active === section ? "secondary" : "ghost", size: "sm" }), "rounded-full")}>{section}</button>
        ))}
      </div>
      <div className="mt-4">{body}</div>
    </section>
  );
}
```

- [ ] **Step 5: Recompose `work-page-client.tsx` around the new workbench order**

Update `src/components/work/work-page-client.tsx` so the render tree follows this shape:

```tsx
const primaryActionContent = currentRun?.status === "WaitingForApproval" ? (
  <div className="space-y-4">
    {(data.currentIntervention?.approvals ?? []).map((approval) => (
      <div key={approval.id} className="rounded-2xl border border-amber-200/80 bg-amber-50/90 p-4">
        <p className="font-medium text-foreground">{approval.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{approval.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={async () => { await runAction(async () => { await approveApproval(approval.id); }); }}>
            <button type="submit" disabled={isPending} className={buttonVariants({ variant: "default" })}>{copy.approve}</button>
          </form>
          <form action={async () => { await runAction(async () => { await rejectApproval(approval.id); }); }}>
            <button type="submit" disabled={isPending} className={buttonVariants({ variant: "destructive" })}>{copy.reject}</button>
          </form>
          <form action={async (formData) => { await runAction(async () => { await editAndApproveApproval(formData); }); }} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input type="hidden" name="approvalId" value={approval.id} />
            <input type="text" name="editedContent" placeholder={copy.editedInstruction} className={cn(inputClassName, "w-full min-w-0")} />
            <button type="submit" disabled={isPending} className={buttonVariants({ variant: "outline" })}>{copy.editAndApprove}</button>
          </form>
        </div>
      </div>
    ))}
  </div>
) : (
  <form key={`workbench-${composerResetKey}-${currentRun?.id ?? "none"}-${workbenchComposer.mode}`} action={handleWorkbenchSubmit} className="space-y-3">
    {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
    <textarea
      aria-label={workbenchComposer.inputLabel}
      name="message"
      rows={6}
      required
      value={composerValue}
      placeholder={workbenchComposer.placeholder}
      onChange={(event) => setComposerValue(event.target.value)}
      onKeyDown={handleComposerKeyDown}
      className={cn(textareaClassName, "min-h-32 w-full resize-y")}
    />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {quickPrompts.map((prompt) => (
          <button key={prompt} type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setComposerValue((current) => (current.trim() ? `${current.trim()}\n${prompt}` : prompt))}>{prompt}</button>
        ))}
      </div>
      <button type="submit" disabled={isPending} className={buttonVariants({ variant: workbenchComposer.submitVariant ?? "default", size: "lg" })}>{workbenchComposer.submitLabel}</button>
    </div>
  </form>
);

const resultActions = (
  <>
    {data.closure.canAcceptResult ? <button type="button" className={buttonVariants({ variant: "default" })}>{copy.acceptResult}</button> : null}
    {data.closure.canRetry ? <button type="button" className={buttonVariants({ variant: "outline" })}>{copy.retryRun}</button> : null}
  </>
);

return (
  <div className="space-y-5">
    <TaskShell
      title={data.taskShell.title}
      taskStatus={taskStatusMeta.label}
      runStatus={currentRun?.status ?? copy.noActiveRunYet}
      scheduleStatus={data.scheduleImpact.status}
      blocker={currentException ?? data.currentIntervention?.whyNow ?? taskSummary}
      scheduleHref="/schedule"
      taskHref={`/workspaces/${data.taskShell.workspaceId}/tasks/${data.taskShell.id}`}
    />

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_320px] xl:items-start">
      <div className="space-y-5">
        <NextActionHero
          title={data.currentIntervention?.title ?? copy.nextAction}
          description={data.currentIntervention?.description ?? copy.workbenchDescription}
          statusLine={data.currentIntervention?.whyNow ?? taskSummary}
          content={primaryActionContent}
        />

        <LatestResultPanel
          title={data.latestOutput.empty ? copy.resultEmptyTitle : data.latestOutput.title}
          body={data.latestOutput.body}
          sourceLabel={data.latestOutput.sourceLabel}
          updatedAt={data.latestOutput.timestamp ? formatDateTime(data.latestOutput.timestamp) : null}
          actions={resultActions}
        />

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Execution Stream</SurfaceCardTitle>
          </SurfaceCardHeader>
          <div className="mt-4">
            <CollaborationStream
              title={copy.collaborationFlow}
              description={copy.collaborationFlowDescription}
              emptyState={copy.fallbackNoOperatorInput}
              composerTitle={copy.inputArea}
              composerLabel={copy.taskArrangement}
              composerHint={workbenchComposer.description || copy.workbenchDescription}
              composerSectionId="current-next-action"
              fixedHeightClassName="h-[520px]"
              items={collaborationStreamItems}
            />
            <ExecutionTimeline title={copy.latestExecutionMilestones} events={data.workstreamItems} />
          </div>
        </SurfaceCard>
      </div>

      <div className="xl:sticky xl:top-4">
        <WorkInspector
          plan={<div className="space-y-3 text-sm text-muted-foreground"><p className="font-medium text-foreground">任务计划</p><p>{data.taskPlan.summary ?? "还没有任务计划。"}</p></div>}
          artifacts={<div className="space-y-3 text-sm text-muted-foreground">{data.inspector.artifacts.length === 0 ? <p>当前没有产出。</p> : data.inspector.artifacts.map((artifact) => <p key={artifact.id}>{artifact.title}</p>)}</div>}
          tools={<div className="space-y-3 text-sm text-muted-foreground">{data.inspector.toolCalls.length === 0 ? <p>当前没有工具调用记录。</p> : data.inspector.toolCalls.map((tool) => <p key={tool.id}>{tool.toolName} · {tool.status}</p>)}</div>}
          context={<div className="space-y-2 text-sm text-muted-foreground"><p><span className="text-foreground">优先级：</span>{data.taskShell.priority}</p><p><span className="text-foreground">计划状态：</span>{data.scheduleImpact.summary}</p></div>}
        />
      </div>
    </div>
  </div>
);
```

Refactor the current approval forms and composer so they both render through `primaryActionContent` rather than appearing as separate competing cards.

- [ ] **Step 6: Remove old side-rail imports and file usage**

Stop importing `RunSidePanel` and `TaskPlanSidePanel` from `work-page-client.tsx`.

If no other file imports them, delete both files:

```tsx
// remove these imports
import { RunSidePanel } from "@/components/work/run-side-panel";
import { TaskPlanSidePanel } from "@/components/work/task-plan-side-panel";
```

Delete:

```text
src/components/work/run-side-panel.tsx
src/components/work/task-plan-side-panel.tsx
```

- [ ] **Step 7: Run the Work tests until they pass**

Run: `bun run test -- src/components/work/__tests__/work-page.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the Work redesign slice**

```bash
git add src/components/work/task-shell.tsx src/components/work/next-action-hero.tsx src/components/work/latest-result-panel.tsx src/components/work/work-inspector.tsx src/components/work/work-page-client.tsx src/components/work/__tests__/work-page.test.tsx
git rm src/components/work/run-side-panel.tsx src/components/work/task-plan-side-panel.tsx
git commit -m "feat: turn work into an action-first workbench"
```

---

### Task 3: Polish Responsive Behavior And Verify End-To-End Page Semantics

**Files:**
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify: `src/components/work/work-page-client.tsx`
- Modify: `src/components/schedule/__tests__/schedule-page.test.tsx`
- Modify: `src/components/work/__tests__/work-page.test.tsx`

- [ ] **Step 1: Add responsive-order tests**

Add assertions that the DOM order matches the intended mobile reading order.

```tsx
it("keeps Work mobile order focused on action before context", () => {
  const approvalState = {
    taskShell: { id: "task_1", workspaceId: "ws_1", title: "Write projection", runtimeModel: "gpt-5.4", prompt: null, status: "Blocked", priority: "High", dueAt: null, scheduledStartAt: "2026-04-16T09:00:00.000Z", scheduledEndAt: "2026-04-16T11:00:00.000Z", scheduleStatus: "AtRisk", blockReason: { actionRequired: "Approve / Reject / Edit and Approve" } },
    currentRun: { id: "run_1", status: "WaitingForApproval", pendingInputPrompt: "Need operator guidance" },
    currentIntervention: { kind: "approval", title: "Resolve approval", description: "Allow the agent to edit files.", whyNow: "A human decision is required before the next execution step can proceed.", actionLabel: "Approve / Reject / Edit", evidence: [], approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }] },
    latestOutput: { kind: "message", title: "Latest agent output", body: "The agent prepared a safe file edit plan.", timestamp: "2026-04-16T10:15:00.000Z", href: null, empty: false, sourceLabel: "Conversation output" },
    scheduleImpact: { status: "AtRisk", dueAt: null, scheduledStartAt: "2026-04-16T09:00:00.000Z", scheduledEndAt: "2026-04-16T11:00:00.000Z", summary: "Execution timing is slipping against the planned window." },
    reliability: { refreshedAt: "2026-04-16T10:16:00.000Z", lastSyncedAt: "2026-04-16T10:15:00.000Z", lastUpdatedAt: "2026-04-16T10:15:00.000Z", syncStatus: "healthy", isStale: false, stuckFor: "1m", stopReason: "Approve / Reject / Edit and Approve" },
    closure: { resultAccepted: false, acceptedAt: null, isDone: false, doneAt: null, canAcceptResult: false, canMarkDone: false, canCreateFollowUp: false, canRetry: false, canReopen: false, latestFollowUp: null },
    taskPlan: { state: "ready", revision: "generated", generatedBy: "work-plan-agent", isMock: true, summary: "先澄清目标与背景，再执行首轮产出。", updatedAt: "2026-04-16T10:16:00.000Z", changeSummary: "已基于当前任务背景生成初始占位计划。", currentStepId: "execute-task", steps: [{ id: "execute-task", title: "推进首轮产出", objective: "推进当前执行并处理审批节点。", phase: "执行", status: "waiting_for_user", needsUserInput: true }] },
    workstreamItems: [],
    conversation: [],
    inspector: { approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }], artifacts: [], toolCalls: [] },
  } as const;

  render(<WorkPageClient initialData={approvalState} />);

  const headings = screen.getAllByRole("heading").map((node) => node.textContent);
  expect(headings).toContain("Current Next Action");
  expect(headings.indexOf("Current Next Action")).toBeLessThan(headings.indexOf("Inspector"));
});

it("keeps Schedule action rail secondary to the timeline canvas", () => {
  render(<SchedulePage workspaceId="ws_1" selectedDay="2026-04-16" data={buildBaseData()} />);

  const timelineHeading = screen.getByRole("heading", { name: "Scheduled Timeline" });
  const rail = screen.getByRole("region", { name: "Schedule Action Rail" });
  expect(timelineHeading.compareDocumentPosition(rail)).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused tests to verify they fail if not implemented**

Run: `bun run test -- src/components/schedule/__tests__/schedule-page.test.tsx src/components/work/__tests__/work-page.test.tsx`

Expected: FAIL until the final ordering and accessibility labels are in place.

- [ ] **Step 3: Apply the final visual polish and accessibility labels**

Make sure the two page files include these final structural classes and labels:

```tsx
// Schedule main grid
<div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_360px] xl:items-start">

// Work main grid
<div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_320px] xl:items-start">

// Accessible rail region
<section aria-label="Schedule Action Rail">

// Accessible inspector heading
<h2 className="text-base font-semibold tracking-tight">Inspector</h2>
```

Keep hero sections visually strongest by using darker/high-contrast backgrounds and larger padding than supporting cards.

- [ ] **Step 4: Run the full targeted verification set**

Run: `bun run test -- src/components/schedule/__tests__/schedule-page.test.tsx src/components/work/__tests__/work-page.test.tsx && bun run lint`

Expected: all targeted component tests PASS and `eslint` exits 0.

- [ ] **Step 5: Commit the final polish and verification slice**

```bash
git add src/components/schedule/schedule-page.tsx src/components/work/work-page-client.tsx src/components/schedule/__tests__/schedule-page.test.tsx src/components/work/__tests__/work-page.test.tsx
git commit -m "fix: polish schedule and work reading flow"
```
