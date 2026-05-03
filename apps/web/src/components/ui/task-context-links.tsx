"use client";

import { ExternalLink, PanelRightOpen } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

type TaskContextLinksProps = {
  workspaceId: string;
  taskId: string;
  latestRunStatus?: string | null;
  taskLabel?: string;
  workLabel?: string;
  size?: "xs" | "sm" | "default" | "lg";
  className?: string;
};

export function TaskContextLinks({
  workspaceId,
  taskId,
  latestRunStatus,
  taskLabel,
  workLabel,
  size = "default",
  className,
}: TaskContextLinksProps) {
  const { t } = useI18n();

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <LocalizedLink
        href={`/workspaces/${workspaceId}/tasks/${taskId}`}
        className={buttonVariants({ variant: "outline", size })}
      >
        <ExternalLink className="size-3.5" />
        {taskLabel ?? t("common.openTask")}
      </LocalizedLink>
      <LocalizedLink
        href={`/workspaces/${workspaceId}/work/${taskId}`}
        className={buttonVariants({ variant: "secondary", size })}
      >
        <PanelRightOpen className="size-3.5" />
        {workLabel ?? (latestRunStatus ? t("common.openWorkbench") : t("common.startWork"))}
      </LocalizedLink>
    </div>
  );
}
