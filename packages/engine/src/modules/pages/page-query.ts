import { getSchedulePage } from "./get-schedule-page";
import { getInbox } from "./get-inbox";
import { getMemoryConsole } from "./get-memory-console";
import { getDashboard } from "./get-dashboard";

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
}

export const pageQuery = new PageQuery();
