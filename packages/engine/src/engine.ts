import type { ChronaEnginePorts } from "./ports";
import { createAiClientsService } from "./services/ai-clients.service";
import { createGoalsService } from "./services/goals.service";
import { createGoalWorkbenchService } from "./services/goal-workbench.service";
import { createAgentToolOperationsService } from "./modules/agent-tools";
import { createPagesService } from "./services/pages.service";
import { createRuntimeService } from "./services/runtime.service";
import { createTaskExecutionService } from "./services/task-execution.service";
import { createTaskLifecycleService } from "./services/task-lifecycle.service";
import { createTaskPlanService } from "./services/task-plan.service";
import { createTaskResultService } from "./services/task-result.service";
import { createTaskScheduleService } from "./services/task-schedule.service";
import { createTasksService } from "./services/tasks.service";
import { createTaskTriggersService } from "./services/task-triggers.service";
import { createWorkspacesService } from "./services/workspaces.service";
import { aiClientRegistry, getAiClient } from "./modules/ai";

export function createChronaEngine(_ports: ChronaEnginePorts = {}) {
  const tasks = createTasksService();
  const schedule = createTaskScheduleService();
  const plan = createTaskPlanService();
  const execution = createTaskExecutionService();

  return {
    tasks: {
      ...tasks,
      schedule,
      plan,
      execution,
      lifecycle: createTaskLifecycleService(),
      result: createTaskResultService(),
    },
    agentTools: createAgentToolOperationsService({ tasks, schedule, plan, execution }),
    pages: createPagesService(),
    goals: {
      ...createGoalsService(),
      workbench: createGoalWorkbenchService(),
    },
    triggers: createTaskTriggersService(),
    workspaces: createWorkspacesService(),
    aiClients: createAiClientsService(),
    runtime: {
      ...createRuntimeService(),
      aiClients: {
        get: (clientId?: string | null) => getAiClient(clientId),
        list: () => aiClientRegistry.list(),
        refresh: () => aiClientRegistry.refresh(),
      },
    },
  };
}

export type ChronaEngine = ReturnType<typeof createChronaEngine>;
