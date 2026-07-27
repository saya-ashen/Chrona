import {
  applyTaskTriggerAction,
  activateEmailDelivery,
  activateInternalEvent,
  createTaskTrigger,
  getTaskOccurrence,
  listTaskOccurrences,
  updateTaskTrigger,
} from "../modules/triggers/task-triggers";

export function createTaskTriggersService() {
  return {
    create: createTaskTrigger,
    update: updateTaskTrigger,
    action: applyTaskTriggerAction,
    activateEmail: activateEmailDelivery,
    activateEvent: activateInternalEvent,
    listOccurrences: listTaskOccurrences,
    getOccurrence: getTaskOccurrence,
  };
}
