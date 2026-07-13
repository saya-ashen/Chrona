export const AI_CLIENTS_CHANGED_EVENT = "chrona:ai-clients-changed";

export function notifyAiClientsChanged() {
  window.dispatchEvent(new Event(AI_CLIENTS_CHANGED_EVENT));
}

export function listenAiClientsChanged(listener: () => void) {
  window.addEventListener(AI_CLIENTS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AI_CLIENTS_CHANGED_EVENT, listener);
}
