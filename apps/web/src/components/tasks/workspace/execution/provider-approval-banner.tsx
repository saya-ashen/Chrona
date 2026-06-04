import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ProviderApprovalChoice = "approve_once" | "approve_session" | "approve_always" | "deny";

type ProviderApprovalReadModel = {
  id: string;
  taskId: string;
  nodeTitle?: string | null;
  provider: string;
  title: string;
  summary: string;
  description?: string | null;
  riskLevel: "low" | "medium" | "high" | "critical" | "unknown";
  subject?: unknown;
  choices: ProviderApprovalChoice[];
  requestedAt: string;
};

type ProviderApprovalListResponse = {
  approvals: ProviderApprovalReadModel[];
};

type ProviderApprovalResolveResponse = {
  approval: ProviderApprovalReadModel;
  status: "resolved" | "not_pending" | "not_active";
};

type ProviderApprovalSubject = {
  type?: string;
  label?: string;
  preview?: string;
  language?: string;
};

function approvalQueryKey(taskId: string) {
  return ["task", taskId, "provider-approvals", "pending"] as const;
}

function asSubject(value: unknown): ProviderApprovalSubject | null {
  if (!value || typeof value !== "object") return null;
  return value as ProviderApprovalSubject;
}

function choiceLabel(choice: ProviderApprovalChoice) {
  switch (choice) {
    case "approve_once":
      return "Approve once";
    case "approve_session":
      return "Approve session";
    case "approve_always":
      return "Always allow";
    case "deny":
      return "Deny";
  }
}

export function ProviderApprovalBanner({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: approvalQueryKey(taskId),
    queryFn: () => apiJson<ProviderApprovalListResponse>(`/api/tasks/${taskId}/provider-approvals?status=pending`),
    refetchInterval: 5_000,
  });
  const approval = data?.approvals[0];
  const resolveMutation = useMutation({
    mutationFn: (input: { approvalId: string; choice: ProviderApprovalChoice }) => apiJson<ProviderApprovalResolveResponse>(
      `/api/tasks/${taskId}/provider-approvals/${input.approvalId}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ choice: input.choice }),
      },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: approvalQueryKey(taskId) });
      await queryClient.invalidateQueries({ queryKey: ["task-workspace"] });
    },
  });

  if (!approval) return null;

  const subject = asSubject(approval.subject);
  const quickChoices = approval.choices.filter((choice) => choice !== "approve_always");

  return (
    <Card className="border-amber-400/60 bg-amber-50 text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-50" size="sm">
      <CardHeader className="gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <CardTitle>{approval.title}</CardTitle>
          <p className="text-sm text-amber-900/80 dark:text-amber-100/80">
            {approval.nodeTitle ? `${approval.provider} needs approval for “${approval.nodeTitle}”.` : `${approval.provider} needs approval.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {quickChoices.map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant={choice === "deny" ? "destructive" : choice === "approve_once" ? "default" : "outline"}
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate({ approvalId: approval.id, choice })}
            >
              {choiceLabel(choice)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{approval.description ?? approval.summary}</p>
        {subject?.preview ? (
          <pre className="max-h-44 overflow-auto rounded-md bg-background/80 p-3 text-xs text-foreground ring-1 ring-foreground/10">
            <code>{subject.preview}</code>
          </pre>
        ) : null}
        {approval.choices.includes("approve_always") ? (
          <Button
            size="sm"
            variant="outline"
            disabled={resolveMutation.isPending || approval.riskLevel === "critical"}
            onClick={() => resolveMutation.mutate({ approvalId: approval.id, choice: "approve_always" })}
          >
            Always allow this provider action
          </Button>
        ) : null}
        {resolveMutation.error ? (
          <p className="text-sm text-destructive">{resolveMutation.error instanceof Error ? resolveMutation.error.message : "Failed to resolve approval"}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
