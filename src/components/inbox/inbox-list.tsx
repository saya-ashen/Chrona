import type { ReactNode } from "react";

type InboxListProps = {
  items: Array<{
    id: string;
    actionType: string;
    riskLevel: string;
    sourceTaskTitle: string;
    currentRunLabel: string;
    summary: string;
    consequence: string;
    actions?: ReactNode;
  }>;
};

export function InboxList({ items }: InboxListProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <section key={item.id} className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="grid gap-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{item.actionType}</p>
            <p>Risk: {item.riskLevel}</p>
            <p>Task: {item.sourceTaskTitle}</p>
            <p>Run: {item.currentRunLabel}</p>
            <p>{item.summary}</p>
            <p>{item.consequence}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {item.actions ?? (
              <>
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white"
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="rounded-md border px-3 py-2 text-sm text-foreground"
                >
                  Edit and Approve
                </button>
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
