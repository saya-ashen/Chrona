import type { createTasksService } from "../../services/tasks.service";
import type { TaskPlanService } from "../../services/task-plan.service";
import type { createTaskScheduleService } from "../../services/task-schedule.service";
import type { createTaskExecutionService } from "../../services/task-execution.service";
import type { createTaskLifecycleService } from "../../services/task-lifecycle.service";
import type { createTaskResultService } from "../../services/task-result.service";
export type ManagementDeps = {
  tasks: ReturnType<typeof createTasksService>;
  plan: TaskPlanService;
  schedule: ReturnType<typeof createTaskScheduleService>;
  execution: ReturnType<typeof createTaskExecutionService>;
  lifecycle: ReturnType<typeof createTaskLifecycleService>;
  result: ReturnType<typeof createTaskResultService>;
};
