import type { UiDocument } from "@chrona/ui-protocol";
import { SpecRenderer, type ExecutionOverviewCard } from "@features/task-workspace/ui";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import { buildCommandCenterNowSpec } from "./build-execution-overview-spec";
import { ProviderApprovalBanner } from "./provider-approval-banner";
import type { CommandCenterPrimaryAction } from "./task-workspace-execution-overview";

/**
 * Persistent action rail for the command center. Surfaces the highest-priority
 * "what needs you" content — provider approvals plus the current operation /
 * primary action — above the tabbed archive so it is never hidden behind a tab.
 *
 * Content source priority:
 *   1. Server-driven `commandCenter.documents.now` when present.
 *   2. Frontend fallback `buildCommandCenterNowSpec` derived from `primaryAction`.
 */
export function TaskWorkspaceActionRail({
  taskId,
  workBlockId,
  executionScope,
  serverNowSpec,
  primaryAction,
  readiness,
  attention,
  runtimeEvents,
  commandCenterActionHandlers,
  copy,
}: {
  taskId: string;
  workBlockId?: string | null;
  executionScope?: string | null;
  serverNowSpec: UiDocument | null;
  primaryAction?: CommandCenterPrimaryAction | null;
  readiness: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
  commandCenterActionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  copy: Record<string, string | undefined>;
}) {
  const spec = serverNowSpec ?? buildCommandCenterNowSpec({ primaryAction, readiness, attention, runtimeEvents, copy });
  const handlers = {
    ...(commandCenterActionHandlers ?? {}),
    ...(primaryAction?.actionHandlers ?? {}),
    "command-center-primary": (params: Record<string, unknown>) => {
      const actionId = typeof params.actionId === "string" ? params.actionId : null;
      if (actionId === (primaryAction?.kind ?? primaryAction?.label)) primaryAction?.onClick?.();
    },
  };

  // The current-operation card is only meaningful when there is something to
  // act on. The resolved primary action flags passive terminal states
  // (no-operation / task-completed) via `suppressAttentionCard`. In those
  // states the engine still emits a server `now` document ("Execution
  // complete / No active execution session"), but showing it under a "Current
  // operation" heading is contradictory — there is no current operation. So a
  // passive primary action hides the rail even when a server doc is present,
  // unless there's still genuine attention (e.g. a pending approval) or live
  // runtime activity to surface.
  const isPassive = Boolean(
    primaryAction &&
      primaryAction.suppressAttentionCard &&
      !primaryAction.actionSpec &&
      !primaryAction.onClick,
  );
  const hasActionContent = Boolean(
    attention ||
      runtimeEvents.length > 0 ||
      primaryAction?.actionSpec ||
      primaryAction?.onClick ||
      ((serverNowSpec || primaryAction) && !isPassive),
  );

  // Provider approvals require a concrete occurrence and plan-run scope; the
  // banner self-gates when that scoped request has no pending approvals.
  return (
    <div className="shrink-0 empty:hidden [&:not(:empty)]:mb-2.5 [&:not(:empty)]:space-y-2">
      {workBlockId && executionScope ? <ProviderApprovalBanner taskId={taskId} workBlockId={workBlockId} executionScope={executionScope} /> : null}
      {hasActionContent ? (
        <SpecRenderer
          key={serverNowSpec ? "now-server" : (primaryAction?.kind ?? "now")}
          spec={spec}
          handlers={handlers}
          onStateChange={primaryAction?.onActionStateChange}
        />
      ) : null}
    </div>
  );
}
