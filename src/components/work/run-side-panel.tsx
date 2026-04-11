"use client";

import { useI18n } from "@/i18n/client";

type RunSidePanelProps = {
  currentRun:
    | {
        id: string;
        status: string;
        startedAt?: string | null;
        endedAt?: string | null;
        updatedAt?: string | null;
        lastSyncedAt?: string | null;
        syncStatus?: string | null;
        resumeSupported?: boolean | null;
        pendingInputPrompt?: string | null;
        errorSummary?: string | null;
      }
    | null;
  reliability: {
    refreshedAt: string;
    lastSyncedAt: string | null;
    lastUpdatedAt: string | null;
    syncStatus: string | null;
    isStale: boolean;
    stuckFor: string | null;
    stopReason: string | null;
  };
  approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
  artifacts: Array<{ id: string; title: string; type: string; uri?: string | null }>;
  toolCalls: Array<{
    id: string;
    toolName: string;
    status: string;
    argumentsSummary?: string | null;
    resultSummary?: string | null;
    errorSummary?: string | null;
  }>;
};

const DEFAULT_COPY = {
  runSnapshot: "Run Snapshot",
  runSnapshotDescription: "Keep this side rail as a lightweight inspector for run health, approvals, artifacts, and tool evidence.",
  noRun: "No run",
  sync: "Sync",
  refreshed: "Refreshed",
  lastSync: "Last sync",
  lastUpdate: "Last update",
  stopReason: "Stop reason",
  stuckFor: "Stuck for",
  stale: "Stale",
  healthy: "Healthy",
  approvalSingular: "approval",
  approvalPlural: "approvals",
  started: "Started",
  ended: "Ended",
  resumeSupported: "Resume supported",
  yes: "Yes",
  no: "No",
  prompt: "Task arrangement",
  noActiveRunYet: "No active run yet.",
  evidence: "Evidence",
  evidenceDescription: "Approvals, artifacts, and tool output stay here as supporting context rather than the main work area.",
  approvals: "Approvals",
  noPendingApprovals: "No pending approvals.",
  artifacts: "Artifacts",
  noArtifacts: "No artifacts.",
  toolActivity: "Tool Activity",
  noToolCalls: "No tool calls.",
} as const;

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

export function RunSidePanel({
  currentRun,
  reliability,
  approvals,
  artifacts,
  toolCalls,
}: RunSidePanelProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.runSidePanel ?? {}) };
  const hasBlockingApprovals = approvals.length > 0;

  return (
    <aside className="space-y-4">
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{copy.runSnapshot}</h2>
          <p className="text-sm text-muted-foreground">{copy.runSnapshotDescription}</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border px-2 py-1">{currentRun?.status ?? copy.noRun}</span>
          <span className="rounded-full border px-2 py-1">{copy.sync} {currentRun?.syncStatus ?? "-"}</span>
          <span className="rounded-full border px-2 py-1">{reliability.isStale ? copy.stale : copy.healthy}</span>
          {hasBlockingApprovals ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-amber-700">{approvals.length} {approvals.length === 1 ? copy.approvalSingular : copy.approvalPlural}</span> : null}
        </div>

        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <div className="grid gap-1 rounded-lg bg-background/80 p-3">
            <p>{copy.refreshed}: {formatDate(reliability.refreshedAt)}</p>
            <p>{copy.lastSync}: {formatDate(reliability.lastSyncedAt)}</p>
            <p>{copy.lastUpdate}: {formatDate(reliability.lastUpdatedAt ?? currentRun?.updatedAt)}</p>
            <p>{copy.started}: {formatDate(currentRun?.startedAt)}</p>
            <p>{copy.ended}: {formatDate(currentRun?.endedAt)}</p>
            <p>{copy.resumeSupported}: {currentRun?.resumeSupported ? copy.yes : copy.no}</p>
            {reliability.stuckFor ? <p>{copy.stuckFor}: {reliability.stuckFor}</p> : null}
            {reliability.stopReason ? <p>{copy.stopReason}: {reliability.stopReason}</p> : null}
            {currentRun?.pendingInputPrompt ? <p>{copy.prompt}: {currentRun.pendingInputPrompt}</p> : null}
          </div>
          {!currentRun ? <p>{copy.noActiveRunYet}</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{copy.evidence}</h2>
          <p className="text-sm text-muted-foreground">{copy.evidenceDescription}</p>
        </div>

        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <details className="rounded-lg border bg-background p-3" open={hasBlockingApprovals}>
            <summary className="cursor-pointer list-none font-medium text-foreground">
              {copy.approvals} {approvals.length > 0 ? `(${approvals.length})` : ""}
            </summary>
            <div className="mt-3 space-y-3">
              {approvals.length === 0 ? (
                <p>{copy.noPendingApprovals}</p>
              ) : (
                approvals.map((approval) => (
                  <div key={approval.id} className="rounded-lg border bg-card px-3 py-2">
                    <p className="font-medium text-foreground">{approval.title}</p>
                    <p>{approval.status}</p>
                    {approval.summary ? <p className="mt-1 text-xs">{approval.summary}</p> : null}
                  </div>
                ))
              )}
            </div>
          </details>

          <details className="rounded-lg border bg-background p-3">
            <summary className="cursor-pointer list-none font-medium text-foreground">
              {copy.artifacts} {artifacts.length > 0 ? `(${artifacts.length})` : ""}
            </summary>
            <div className="mt-3 space-y-3">
              {artifacts.length === 0 ? (
                <p>{copy.noArtifacts}</p>
              ) : (
                artifacts.map((artifact) => (
                  <div key={artifact.id} className="rounded-lg border bg-card px-3 py-2">
                    <p className="font-medium text-foreground">{artifact.title}</p>
                    <p>{artifact.type}</p>
                  </div>
                ))
              )}
            </div>
          </details>

          <details className="rounded-lg border bg-background p-3">
            <summary className="cursor-pointer list-none font-medium text-foreground">
              {copy.toolActivity} {toolCalls.length > 0 ? `(${toolCalls.length})` : ""}
            </summary>
            <div className="mt-3 space-y-3">
              {toolCalls.length === 0 ? (
                <p>{copy.noToolCalls}</p>
              ) : (
                toolCalls.map((tool) => (
                  <div key={tool.id} className="rounded-lg border bg-card px-3 py-2">
                    <p className="font-medium text-foreground">{tool.toolName}</p>
                    <p>{tool.status}</p>
                  </div>
                ))
              )}
            </div>
          </details>
        </div>
      </section>
    </aside>
  );
}
