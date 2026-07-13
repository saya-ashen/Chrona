"use client";

import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { localizeHref } from "@chrona/i18n";
import { useI18n, useLocale } from "@chrona/i18n"
import { Button, cn } from "@shared/ui";

type TaskContextLinksProps = {
  taskId: string;
  workBlockId?: string | null;
  taskLabel?: string;
  size?: "xs" | "sm" | "default" | "lg";
  className?: string;
};

export function TaskContextLinks({
  taskId,
  workBlockId,
  taskLabel,
  size = "default",
  className,
}: TaskContextLinksProps) {
  const { t } = useI18n();
  const locale = useLocale();

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button asChild variant="outline" size={size}>
        <Link to={localizeHref(locale, workBlockId ? `/tasks/${taskId}?workBlockId=${encodeURIComponent(workBlockId)}` : `/tasks/${taskId}`)}>
          <ExternalLink className="size-3.5" />
          {taskLabel ?? t("common.openTask")}
        </Link>
      </Button>
    </div>
  );
}
