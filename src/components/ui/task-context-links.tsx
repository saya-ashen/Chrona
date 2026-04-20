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
  size = "sm",
  className,
}: TaskContextLinksProps) {
  const { t } = useI18n();

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <LocalizedLink
        href={`/workspaces/${workspaceId}/tasks/${taskId}`}
        className={cn(
          buttonVariants({ variant: "outline", size }),
          "gap-2 rounded-lg border-border/60 bg-background/90 shadow-sm hover:border-primary/40 hover:bg-primary/5",
        )}
      >
        <ExternalLink className="size-3.5" />
        {taskLabel ?? t("common.openTask")}
      </LocalizedLink>
      <LocalizedLink
        href={`/workspaces/${workspaceId}/work/${taskId}`}
        className={cn(
          buttonVariants({ variant: "secondary", size }),
          "gap-2 rounded-lg bg-primary/10 text-primary shadow-sm hover:bg-primary/15",
        )}
      >
        <PanelRightOpen className="size-3.5" />
        {workLabel ?? (latestRunStatus ? t("common.openWorkbench") : t("common.startWork"))}
      </LocalizedLink>
    </div>
  );
}
