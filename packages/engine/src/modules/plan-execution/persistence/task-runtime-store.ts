import { getAiClientForTask } from "@/modules/ai";

/** Resolve runtime provenance from the authoritative task execution AI client. */
export async function getRuntimeName(taskId: string): Promise<string> {
  const client = await getAiClientForTask({
    taskId,
    purpose: "task.execution",
  });
  return client?.providerClient?.provider ?? client?.record.type ?? "unconfigured";
}
