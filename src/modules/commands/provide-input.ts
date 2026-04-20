import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { resumeRun } from "@/modules/commands/resume-run";
import type { OpenClawAdapter } from "@/modules/openclaw/adapter";

export async function provideInput(input: {
  runId: string;
  inputText: string;
  adapter?: OpenClawAdapter;
}) {
  const run = await db.run.findUnique({ where: { id: input.runId } });

  if (!run) {
    throw new Error("The run no longer exists. Refresh the work page and try again.");
  }

  if (run.status !== RunStatus.WaitingForInput) {
    throw new Error("Input can only be provided when the run is waiting for input.");
  }

  return resumeRun({
    runId: run.id,
    inputText: input.inputText,
    adapter: input.adapter,
  });
}
