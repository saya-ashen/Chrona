import type { ChronaToolName } from "@chrona/contracts";
import type { createTaskExecutionService } from "../../services/task-execution.service";
import type { createTaskPlanService } from "../../services/task-plan.service";
import type { createTaskScheduleService } from "../../services/task-schedule.service";
import type { createTasksService } from "../../services/tasks.service";
import type { GoalAcceptedResultsReader } from "../../services/goals.service";

export type AgentToolOperationsDeps = {
  tasks: ReturnType<typeof createTasksService>;
  plan: ReturnType<typeof createTaskPlanService>;
  schedule: ReturnType<typeof createTaskScheduleService>;
  execution: ReturnType<typeof createTaskExecutionService>;
  goals: GoalAcceptedResultsReader;
};

export type ToolAuditContext = {
  operationId: string;
  toolName: ChronaToolName;
  workspaceId: string;
  taskId?: string | null;
  runId?: string | null;
  executionSessionId?: string | null;
  planId?: string | null;
  planRunId?: string | null;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  nodeId?: string | null;
  nodeTitle?: string | null;
  inputRawEventId?: string | null;
  invocationId?: string | null;
};

export type ToolAuditScope = {
  runId?: string | null;
  executionSessionId?: string | null;
  planId?: string | null;
  planRunId?: string | null;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  nodeId?: string | null;
};
