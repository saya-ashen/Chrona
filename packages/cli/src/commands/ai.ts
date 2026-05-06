import { Command } from "commander";
import type { ClientResolver } from "./shared.js";
import {
  createOutputOption,
  parseJsonOption,
  runCommand,
  type CommonCommandOptions,
} from "./shared.js";
import { formatAutoComplete, formatPlanResult } from "../output/ai.js";

export function registerAiCommands(
  program: Command,
  getClient: ClientResolver,
): void {
  const ai = program.command("ai").description("AI-related app API commands");

  createOutputOption(
    ai
      .command("generate-plan")
      .description("Generate a task plan graph for an existing task")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .option("--force-refresh", "Ignore cached plan", false)
      .action(
        async (
          options: CommonCommandOptions & {
            taskId: string;
            forceRefresh: boolean;
          },
        ) => {
          await runCommand(
            () =>
              getClient().generateTaskPlan({
                taskId: options.taskId,
                forceRefresh: options.forceRefresh,
              }),
            options,
            formatPlanResult,
          );
        },
      ),
  );

  createOutputOption(
    ai
      .command("auto-complete")
      .description("Request task creation auto-complete suggestions")
      .requiredOption("--title <title>", "Partial title")
      .option("-w, --workspace-id <id>", "Workspace ID for richer context")
      .action(
        async (
          options: CommonCommandOptions & {
            title: string;
            workspaceId?: string;
          },
        ) => {
          await runCommand(
            () =>
              getClient().autoComplete({
                title: options.title,
                workspaceId: options.workspaceId,
              }),
            options,
            formatAutoComplete,
          );
        },
      ),
  );

  createOutputOption(
    ai
      .command("decompose")
      .description("Compatibility alias for generate-plan --task-id")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(
          () => getClient().generateTaskPlan({ taskId: options.taskId }),
          options,
          formatPlanResult,
        );
      }),
  );
}
