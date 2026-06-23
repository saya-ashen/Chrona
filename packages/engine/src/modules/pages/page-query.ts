import { getSchedulePage } from "./get-schedule-page";
import { getInbox } from "./get-inbox";
import { getMemoryConsole } from "./get-memory-console";
import { getDashboard } from "./get-dashboard";
import { getWorkPage } from "./work-page";

export class PageQuery {
  getSchedule(input: { workspaceId: string }) {
    return getSchedulePage(input.workspaceId);
  }

  getInbox(input: { workspaceId: string }) {
    return getInbox(input.workspaceId);
  }

  getDashboard(input: { workspaceId: string }) {
    return getDashboard(input.workspaceId);
  }

  getMemory(input: { workspaceId: string }) {
    return getMemoryConsole(input.workspaceId);
  }

  getWork(input: { taskId: string }) {
    return getWorkPage(input.taskId);
  }
}

export const pageQuery = new PageQuery();
