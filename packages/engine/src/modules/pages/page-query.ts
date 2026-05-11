import { taskScheduling } from "@/modules/scheduling";
import { getInbox } from "./get-inbox";
import { getMemoryConsole } from "./get-memory-console";
import { getWorkPage } from "./work-page";

export class PageQuery {
  getSchedule(input: { workspaceId: string }) {
    return taskScheduling.getPage(input);
  }

  getInbox(input: { workspaceId: string }) {
    return getInbox(input.workspaceId);
  }

  getMemory(input: { workspaceId: string }) {
    return getMemoryConsole(input.workspaceId);
  }

  getWork(input: { taskId: string }) {
    return getWorkPage(input.taskId);
  }
}

export const pageQuery = new PageQuery();
