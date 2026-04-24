import { Command } from "commander";
import type { ClientResolver } from "./shared.js";
import { createOutputOption, runCommand, type CommonCommandOptions } from "./shared.js";
import { formatRunResult } from "../output/run.js";
import { formatConflicts, formatWorkspace } from "../output/schedule.js";

export function registerScheduleCommands(program: Command, getClient: ClientResolver): void {
  const schedule = program.command("schedule").description("Schedule management");

  createOutputOption(
    schedule
      .command("apply")
      .description("Apply a schedule to a task")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .requiredOption("--start <datetime>", "Scheduled start as ISO-8601")
      .requiredOption("--end <datetime>", "Scheduled end as ISO-8601")
      .action(async (options: CommonCommandOptions & { taskId: string; start: string; end: string }) => {
        await runCommand(
          () => getClient().scheduleTask(options.taskId, options.start, options.end),
          options,
          formatRunResult,
        );
      }),
  );

  createOutputOption(
    schedule
      .command("clear")
      .description("Clear a task schedule")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(() => getClient().clearSchedule(options.taskId), options, formatRunResult);
      }),
  );

  createOutputOption(
    schedule
      .command("view")
      .description("View workspace schedule projection")
      .requiredOption("-w, --workspace-id <id>", "Workspace ID")
      .action(async (options: CommonCommandOptions & { workspaceId: string }) => {
        await runCommand(() => getClient().getScheduleProjection(options.workspaceId), options, formatWorkspace);
      }),
  );

  createOutputOption(
    schedule
      .command("conflicts")
      .description("Analyze scheduling conflicts")
      .requiredOption("-w, --workspace-id <id>", "Workspace ID")
      .option("-d, --date <date>", "Optional focus date")
      .action(async (options: CommonCommandOptions & { workspaceId: string; date?: string }) => {
        await runCommand(
          () => getClient().analyzeConflicts(options.workspaceId, options.date),
          options,
          formatConflicts,
        );
      }),
  );

  createOutputOption(
    schedule
      .command("suggest-time")
      .description("Suggest an available timeslot for a task")
      .requiredOption("-w, --workspace-id <id>", "Workspace ID")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .option("-d, --date <date>", "Optional focus date")
      .action(async (options: CommonCommandOptions & { workspaceId: string; taskId: string; date?: string }) => {
        await runCommand(
          () => getClient().suggestTimeslot(options.workspaceId, options.taskId, options.date),
          options,
        );
      }),
  );
}
