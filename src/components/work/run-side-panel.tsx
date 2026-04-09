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

export function RunSidePanel({ currentRun, approvals, artifacts, toolCalls }: RunSidePanelProps) {
  return (
    <aside className="space-y-4">
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Current Run</h2>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>Status: {currentRun?.status ?? "No run"}</p>
          <p>Started: {formatDate(currentRun?.startedAt)}</p>
          <p>Ended: {formatDate(currentRun?.endedAt)}</p>
          <p>Sync: {currentRun?.syncStatus ?? "-"}</p>
          {currentRun?.pendingInputPrompt ? <p>Input: {currentRun.pendingInputPrompt}</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Pending Approvals</h2>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          {approvals.length === 0 ? (
            <p>No pending approvals.</p>
          ) : (
            approvals.map((approval) => (
              <div key={approval.id} className="rounded-lg border bg-background px-3 py-2">
                <p className="font-medium text-foreground">{approval.title}</p>
                <p>{approval.status}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Artifacts</h2>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          {artifacts.length === 0 ? (
            <p>No artifacts.</p>
          ) : (
            artifacts.map((artifact) => (
              <div key={artifact.id} className="rounded-lg border bg-background px-3 py-2">
                <p className="font-medium text-foreground">{artifact.title}</p>
                <p>{artifact.type}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Tool Activity</h2>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          {toolCalls.length === 0 ? (
            <p>No tool calls.</p>
          ) : (
            toolCalls.map((tool) => (
              <div key={tool.id} className="rounded-lg border bg-background px-3 py-2">
                <p className="font-medium text-foreground">{tool.toolName}</p>
                <p>{tool.status}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}
