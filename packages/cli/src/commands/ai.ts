import { Command } from "commander";
import type { ClientResolver } from "./shared.js";
import {
  createOutputOption,
  parseJsonOption,
  runCommand,
  type CommonCommandOptions,
} from "./shared.js";
import {
  formatAutoComplete,
  formatPlanResult,
} from "../output/ai.js";

export function registerAiCommands(program: Command, getClient: ClientResolver): void {
  const ai = program.command("ai").description("AI-related app API commands");

  createOutputOption(
    ai
      .command("generate-plan")
      .description("Generate a task plan graph")
      .option("-t, --task-id <id>", "Task ID")
      .option("--title <title>", "Ad-hoc task title")
      .option("--description <text>", "Ad-hoc task description")
      .option("--estimated-minutes <number>", "Estimated minutes")
      .option("--planning-prompt <text>", "Planning prompt override")
      .option("--force-refresh", "Ignore cached plan", false)
      .action(async (options: CommonCommandOptions & {
        taskId?: string;
        title?: string;
        description?: string;
        estimatedMinutes?: string;
        planningPrompt?: string;
        forceRefresh: boolean;
      }) => {
        await runCommand(
          () =>
            getClient().generateTaskPlan({
              taskId: options.taskId,
              title: options.title,
              description: options.description,
              estimatedMinutes: options.estimatedMinutes
                ? Number.parseInt(options.estimatedMinutes, 10)
                : undefined,
              planningPrompt: options.planningPrompt,
              forceRefresh: options.forceRefresh,
            }),
          options,
          formatPlanResult,
        );
      }),
  );

  createOutputOption(
    ai
      .command("apply-plan")
      .description("Materialize a generated task plan")
      .requiredOption("-t, --task-id <id>", "Parent task ID")
      .option("--nodes <json>", "Optional JSON array of plan nodes")
      .option("--edges <json>", "Optional JSON array of plan edges")
      .action(async (options: CommonCommandOptions & { taskId: string; nodes?: string; edges?: string }) => {
        await runCommand(
          () =>
            getClient().batchApplyPlan({
              taskId: options.taskId,
              nodes: options.nodes ? parseJsonOption<unknown[]>(options.nodes, "--nodes") : undefined,
              edges: options.edges ? parseJsonOption<unknown[]>(options.edges, "--edges") : undefined,
            }),
          options,
          formatPlanResult,
        );
      }),
  );

  createOutputOption(
    ai
      .command("auto-complete")
      .description("Request task creation auto-complete suggestions")
      .requiredOption("--title <title>", "Partial title")
      .option("-w, --workspace-id <id>", "Workspace ID for richer context")
      .action(async (options: CommonCommandOptions & { title: string; workspaceId?: string }) => {
        await runCommand(
          () => getClient().autoComplete({ title: options.title, workspaceId: options.workspaceId }),
          options,
          formatAutoComplete,
        );
      }),
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

  createOutputOption(
    ai
      .command("batch-decompose")
      .description("Compatibility alias for apply-plan using latest saved plan")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(
          () => getClient().batchApplyPlan({ taskId: options.taskId }),
          options,
          formatPlanResult,
        );
      }),
  );
}
