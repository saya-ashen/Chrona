"use client";

import { buttonVariants } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { getApprovalStatusLabel } from "./work-page-formatters";

type HeroApprovalItem = {
  id: string;
  title: string;
  status: string;
  summary?: string;
};

type HeroApprovalsCopy = {
  approvalSummaryFallback: string;
  approve: string;
  reject: string;
  editedInstruction: string;
  editAndApprove: string;
};

type HeroApprovalsProps = {
  approvals: HeroApprovalItem[];
  isPending: boolean;
  copy: HeroApprovalsCopy;
  onApprove: (approvalId: string) => Promise<void>;
  onReject: (approvalId: string) => Promise<void>;
  onEditAndApprove: (formData: FormData) => Promise<void>;
};

export function HeroApprovals({
  approvals,
  isPending,
  copy,
  onApprove,
  onReject,
  onEditAndApprove,
}: HeroApprovalsProps) {
  if (approvals.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {approvals.map((approval) => (
        <article
          key={approval.id}
          className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-primary-foreground">
              {approval.title}
            </p>
            <StatusBadge tone="warning">
              {getApprovalStatusLabel(approval.status)}
            </StatusBadge>
          </div>

          <p className="mt-2 text-sm text-primary-foreground/75">
            {approval.summary ?? copy.approvalSummaryFallback}
          </p>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <form
                action={async () => {
                  await onApprove(approval.id);
                }}
              >
                <button
                  type="submit"
                  disabled={isPending}
                  className={buttonVariants({
                    variant: "default",
                    className: "disabled:opacity-60",
                  })}
                >
                  {copy.approve}
                </button>
              </form>

              <form
                action={async () => {
                  await onReject(approval.id);
                }}
              >
                <button
                  type="submit"
                  disabled={isPending}
                  className={buttonVariants({
                    variant: "destructive",
                    className: "disabled:opacity-60",
                  })}
                >
                  {copy.reject}
                </button>
              </form>
            </div>

            <form
              action={async (formData) => {
                formData.set("approvalId", approval.id);
                await onEditAndApprove(formData);
              }}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <label
                htmlFor={`approval-edit-${approval.id}`}
                className="sr-only"
              >
                {copy.editedInstruction}
              </label>

              <input
                id={`approval-edit-${approval.id}`}
                type="text"
                name="editedContent"
                placeholder={copy.editedInstruction}
                className={cn(
                  inputClassName,
                  "min-w-0 w-full border-white/12 bg-white/[0.06] text-primary-foreground placeholder:text-primary-foreground/45",
                )}
              />

              <button
                type="submit"
                disabled={isPending}
                className={buttonVariants({
                  variant: "outline",
                  className:
                    "border-white/15 bg-white/[0.04] text-primary-foreground hover:bg-white/[0.08] disabled:opacity-60",
                })}
              >
                {copy.editAndApprove}
              </button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}
