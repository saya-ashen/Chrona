/* eslint-disable complexity -- Approval presentation intentionally enumerates all durable resolution states. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { apiJson } from "@shared/http";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@shared/ui";
import type { PublicProviderDescriptor } from "@chrona/contracts";

type ProviderApprovalChoice = "approve_once" | "approve_session" | "approve_always" | "deny";

type ProviderApprovalReadModel = {
  id: string;
  nodeTitle?: string | null;
  provider: PublicProviderDescriptor;
  title: string;
  summary: string;
  description?: string | null;
  riskLevel: "low" | "medium" | "high" | "critical" | "unknown";
  choices: ProviderApprovalChoice[];
  requestedAt: string;
};

type ProviderApprovalListResponse = {
  approvals: ProviderApprovalReadModel[];
};

type ProviderApprovalResolveResponse = {
  approval: ProviderApprovalReadModel;
  status: "resolved" | "not_pending" | "not_active" | "failed" | "in_flight";
};




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

export function ProviderApprovalBanner({
  taskId,
  workBlockId,
  executionScope,
}: {
  taskId: string;
  workBlockId: string | null;
  executionScope: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const isScoped = Boolean(workBlockId && executionScope);
  const scope = isScoped
    ? new URLSearchParams({ workBlockId: workBlockId!, executionScope: executionScope! }).toString()
    : null;
  const { data } = useQuery({
    queryKey: ["task", taskId, "provider-approvals", workBlockId ?? "__unscoped__", executionScope ?? "__unscoped__", "pending"],
    queryFn: () => apiJson<ProviderApprovalListResponse>(`/api/tasks/${taskId}/provider-approvals?${scope}`),
    enabled: isScoped,
    refetchInterval: 5_000,
  });
  const approvals = Array.isArray(data?.approvals) ? data.approvals : [];
  const approval = approvals[0];
  const resolveMutation = useMutation({
    mutationFn: (input: { approvalId: string; choice: ProviderApprovalChoice }) => apiJson<ProviderApprovalResolveResponse>(
      `/api/tasks/${taskId}/provider-approvals/${input.approvalId}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ workBlockId, executionScope, choice: input.choice, idempotencyKey: uuidv4() }),
      },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["task", taskId, "provider-approvals", workBlockId ?? "__unscoped__", executionScope ?? "__unscoped__", "pending"],
      });
      await queryClient.invalidateQueries({ queryKey: ["task-workspace"] });
    },
  });

  if (!approval) return null;

  const quickChoices = approval.choices.filter((choice) => choice !== "approve_always");

  return (
    <Card className="border-amber-400/60 bg-amber-50 text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-50" size="sm">
      <CardHeader className="gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <CardTitle>{approval.title}</CardTitle>
          <p className="text-sm text-amber-900/80 dark:text-amber-100/80">
            {approval.nodeTitle ? `${approval.provider.label} needs approval for "${approval.nodeTitle}".` : `${approval.provider.label} needs approval.`}
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
