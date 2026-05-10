import type { ChronaEnginePorts } from "./ports";
import { createAiClientsService } from "./services/ai-clients.service";
import { createPagesService } from "./services/pages.service";
import { createRuntimeService } from "./services/runtime.service";
import { createTaskExecutionService } from "./services/task-execution.service";
import { createTaskLifecycleService } from "./services/task-lifecycle.service";
import { createTaskPlanService } from "./services/task-plan.service";
import { createTaskResultService } from "./services/task-result.service";
import { createTaskScheduleService } from "./services/task-schedule.service";
import { createTasksService } from "./services/tasks.service";
import { createWorkspacesService } from "./services/workspaces.service";

export function createChronaEngine(_ports: ChronaEnginePorts = {}) {
  return {
    tasks: {
      ...createTasksService(),
      schedule: createTaskScheduleService(),
      plan: createTaskPlanService(),
      execution: createTaskExecutionService(),
      lifecycle: createTaskLifecycleService(),
      result: createTaskResultService(),
    },
    pages: createPagesService(),
    workspaces: createWorkspacesService(),
    aiClients: createAiClientsService(),
    runtime: createRuntimeService(),
  };
}

export type ChronaEngine = ReturnType<typeof createChronaEngine>;
