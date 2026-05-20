"use client";

import { ExternalLink } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@chrona/i18n/react";

type TaskContextLinksProps = {
  taskId: string;
  taskLabel?: string;
  size?: "xs" | "sm" | "default" | "lg";
  className?: string;
};

export function TaskContextLinks({
  taskId,
  taskLabel,
  size = "default",
  className,
}: TaskContextLinksProps) {
  const { t } = useI18n();

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button asChild variant="outline" size={size}>
        <LocalizedLink href={`/tasks/${taskId}`}>
          <ExternalLink className="size-3.5" />
          {taskLabel ?? t("common.openTask")}
        </LocalizedLink>
      </Button>
    </div>
  );
}
