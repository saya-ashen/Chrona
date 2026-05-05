import { Command } from "commander";
import type { ClientResolver } from "./shared.js";
import { createOutputOption, runCommand, type CommonCommandOptions } from "./shared.js";
import { formatRunResult } from "../output/run.js";

export function registerRunCommands(program: Command, getClient: ClientResolver): void {
  const run = program.command("run").description("Run management");

  createOutputOption(
    run
      .command("start")
      .description("Start a run for a task")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .option("--prompt <text>", "Run prompt override")
      .action(async (options: CommonCommandOptions & { taskId: string; prompt?: string }) => {
        await runCommand(() => getClient().startExecution(options.taskId, options.prompt), options, formatRunResult);
      }),
  );

  createOutputOption(
    run
      .command("message")
      .description("Send a message to a running task")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .requiredOption("-m, --message <text>", "Message text")
      .option("-r, --run-id <id>", "Specific run ID")
      .action(async (options: CommonCommandOptions & { taskId: string; message: string; runId?: string }) => {
        await runCommand(
          () => getClient().sendMessage(options.taskId, options.message, options.runId),
          options,
          formatRunResult,
        );
      }),
  );

  createOutputOption(
    run
      .command("input")
      .description("Provide input to a waiting task run")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .requiredOption("--text <text>", "Input text")
      .action(async (options: CommonCommandOptions & { taskId: string; text: string }) => {
        await runCommand(
          () => getClient().submitExecutionInput(options.taskId, options.text),
          options,
          formatRunResult,
        );
      }),
  );
}
