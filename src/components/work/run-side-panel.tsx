type RunSidePanelProps = {
  currentRun:
    | {
        id: string;
        status: string;
        startedAt?: string | null;
        endedAt?: string | null;
        syncStatus?: string | null;
        resumeSupported?: boolean | null;
        pendingInputPrompt?: string | null;
      }
    | null;
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

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

export function RunSidePanel({
  currentRun,
  approvals,
  artifacts,
  toolCalls,
}: RunSidePanelProps) {
  const hasBlockingApprovals = approvals.length > 0;

  return (
    <aside className="space-y-4">
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Run Snapshot</h2>
          <p className="text-sm text-muted-foreground">Current run state, timing, and sync health.</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border px-2 py-1">{currentRun?.status ?? "No run"}</span>
          <span className="rounded-full border px-2 py-1">Sync {currentRun?.syncStatus ?? "-"}</span>
          {hasBlockingApprovals ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-amber-700">{approvals.length} approval{approvals.length === 1 ? "" : "s"}</span> : null}
        </div>

        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <div className="grid gap-1 rounded-lg bg-background/80 p-3">
            <p>Started: {formatDate(currentRun?.startedAt)}</p>
            <p>Ended: {formatDate(currentRun?.endedAt)}</p>
            <p>Resume supported: {currentRun?.resumeSupported ? "Yes" : "No"}</p>
            {currentRun?.pendingInputPrompt ? <p>Prompt: {currentRun.pendingInputPrompt}</p> : null}
          </div>
          {!currentRun ? <p>No active run yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Evidence</h2>
          <p className="text-sm text-muted-foreground">Approvals, artifacts, and tool output stay here as supporting context.</p>
        </div>

        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <details className="rounded-lg border bg-background p-3" open={hasBlockingApprovals}>
            <summary className="cursor-pointer list-none font-medium text-foreground">
              Approvals {approvals.length > 0 ? `(${approvals.length})` : ""}
            </summary>
            <div className="mt-3 space-y-3">
              {approvals.length === 0 ? (
                <p>No pending approvals.</p>
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
              Artifacts {artifacts.length > 0 ? `(${artifacts.length})` : ""}
            </summary>
            <div className="mt-3 space-y-3">
              {artifacts.length === 0 ? (
                <p>No artifacts.</p>
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
              Tool Activity {toolCalls.length > 0 ? `(${toolCalls.length})` : ""}
            </summary>
            <div className="mt-3 space-y-3">
              {toolCalls.length === 0 ? (
                <p>No tool calls.</p>
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
