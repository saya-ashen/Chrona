import type { ComponentProps } from "react";
import { MessageSquare } from "lucide-react";
import { TaskAiWorkspacePanel } from "../assistant/task-ai-workspace-panel";
import { buttonVariants } from "@/components/ui/button";

type TaskWorkspaceAiSectionProps = {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
} & Omit<ComponentProps<typeof TaskAiWorkspacePanel>, "onClose" | "className">;

export function TaskWorkspaceAiSection({
  isOpen,
  onOpen,
  onClose,
  ...panelProps
}: TaskWorkspaceAiSectionProps) {
  if (isOpen) {
    return (
      <div className="fixed inset-x-4 bottom-4 z-50 xl:right-6 xl:left-auto xl:w-[420px]">
        <TaskAiWorkspacePanel
          {...panelProps}
          onClose={onClose}
          className="h-[min(720px,calc(100vh-7rem))] w-full rounded-[1.45rem] border-border/70 bg-background/95 shadow-[0_24px_70px_rgba(15,23,42,0.18)] backdrop-blur"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={buttonVariants({ variant: "default", className: "fixed bottom-4 right-4 z-50 h-11 rounded-full px-4 shadow-[0_16px_40px_rgba(15,23,42,0.18)] xl:bottom-6 xl:right-6" })}
    >
      <MessageSquare className="size-4" />
      AI workspace
    </button>
  );
}
