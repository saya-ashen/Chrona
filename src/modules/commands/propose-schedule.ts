import type { ScheduleSource } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function proposeSchedule(input: {
  taskId: string;
  source: ScheduleSource;
  proposedBy: string;
  summary: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  assigneeAgentId?: string | null;
}) {
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId } });

  const proposal = await db.scheduleProposal.create({
    data: {
      workspaceId: task.workspaceId,
      taskId: task.id,
      source: input.source,
      status: "Pending",
      proposedBy: input.proposedBy,
      summary: input.summary,
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      assigneeAgentId: input.assigneeAgentId ?? null,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.schedule_proposed",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: input.source === "ai" ? "agent" : "user",
    actorId: input.proposedBy,
    source: input.source === "ai" ? "planner" : "ui",
    payload: {
      proposal_id: proposal.id,
      source: input.source,
      proposed_by: input.proposedBy,
      summary: input.summary,
      due_at: input.dueAt?.toISOString() ?? null,
      scheduled_start_at: input.scheduledStartAt?.toISOString() ?? null,
      scheduled_end_at: input.scheduledEndAt?.toISOString() ?? null,
      assignee_agent_id: input.assigneeAgentId ?? null,
    },
    dedupeKey: `task.schedule_proposed:${proposal.id}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    proposalId: proposal.id,
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}
