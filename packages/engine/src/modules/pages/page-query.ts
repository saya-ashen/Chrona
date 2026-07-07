import { getSchedulePage } from "./get-schedule-page";
import { getActionCenter } from "./get-action-center";
import { getMemoryConsole } from "./get-memory-console";
import { getDashboard } from "./get-dashboard";

export class PageQuery {
  getSchedule(input: { workspaceId: string }) {
    return getSchedulePage(input.workspaceId);
  }

  getActionCenter(input: { workspaceId: string }) {
    return getActionCenter(input.workspaceId);
  }

  getDashboard(input: { workspaceId: string }) {
    return getDashboard(input.workspaceId);
  }

  getMemory(input: { workspaceId: string }) {
    return getMemoryConsole(input.workspaceId);
  }
}

export const pageQuery = new PageQuery();
