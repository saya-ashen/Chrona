import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  taskLabel = "Open Task",
  workLabel,
  size = "sm",
  className,
}: TaskContextLinksProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Link
        href={`/workspaces/${workspaceId}/tasks/${taskId}`}
        className={buttonVariants({ variant: "outline", size })}
      >
        {taskLabel}
      </Link>
      <Link
        href={`/workspaces/${workspaceId}/work/${taskId}`}
        className={buttonVariants({ variant: "secondary", size })}
      >
        {workLabel ?? (latestRunStatus ? "Open Workbench" : "Start Work")}
      </Link>
    </div>
  );
}
