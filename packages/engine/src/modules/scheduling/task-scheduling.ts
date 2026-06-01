import { applySchedule } from "./apply-schedule";
import { autoStartScheduledPlanTasks } from "./auto-start-scheduled-plan";
import { startAutoStartScheduler } from "./auto-start-runner";
import { clearSchedule } from "./clear-schedule";
import { decideScheduleProposal } from "./decide-schedule-proposal";
import { getSchedulePage } from "./get-schedule-page";
import { moveWorkBlock } from "./move-work-block";
import { proposeSchedule } from "./propose-schedule";

export class TaskScheduling {
  apply(input: Parameters<typeof applySchedule>[0]) {
    return applySchedule(input);
  }

  clear(input: Parameters<typeof clearSchedule>[0]) {
    return clearSchedule(input);
  }

  moveWorkBlock(input: Parameters<typeof moveWorkBlock>[0]) {
    return moveWorkBlock(input);
  }

  propose(input: Parameters<typeof proposeSchedule>[0]) {
    return proposeSchedule(input);
  }

  decideProposal(input: Parameters<typeof decideScheduleProposal>[0]) {
    return decideScheduleProposal(input);
  }

  getPage(input: { workspaceId: string }) {
    return getSchedulePage(input.workspaceId);
  }

  autoStartScheduledPlans() {
    return autoStartScheduledPlanTasks();
  }

  startAutoStartScheduler() {
    return startAutoStartScheduler();
  }
}

export const taskScheduling = new TaskScheduling();
