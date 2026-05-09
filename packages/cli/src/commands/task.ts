import { Command } from "commander";
import type { ClientResolver } from "./shared.js";
import {
  createOutputOption,
  parseIntegerOption,
  runCommand,
  type CommonCommandOptions,
} from "./shared.js";
import { formatRunResult } from "../output/run.js";
import { formatTaskDetail, formatTaskList } from "../output/task.js";

function buildExecutionConfig(prompt?: string): Record<string, unknown> | undefined {
  return prompt ? { prompt } : undefined;
}

function parseExecutionRuntime(value?: string): "openclaw" | "research" | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "openclaw" || value === "research") return value;
  throw new Error(`--runtime must be one of: openclaw, research`);
}

export function registerTaskCommands(program: Command, getClient: ClientResolver): void {
  const task = program.command("task").description("Task management");

  createOutputOption(
    task
      .command("list")
      .description("List tasks in a workspace")
      .requiredOption("-w, --workspace-id <id>", "Workspace ID")
      .option("-s, --status <status>", "Filter by task status")
      .option("-l, --limit <number>", "Maximum tasks to return", "50")
      .action(async (options: CommonCommandOptions & { workspaceId: string; status?: string; limit: string }) => {
        await runCommand(
          () => getClient().listTasks(options.workspaceId, {
            status: options.status,
            limit: parseIntegerOption(options.limit, "--limit"),
          }),
          options,
          formatTaskList,
        );
      }),
  );

  createOutputOption(
    task
      .command("get")
      .description("Get task details")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(() => getClient().getTaskDetail(options.taskId), options, formatTaskDetail);
      }),
  );

  createOutputOption(
    task
      .command("create")
      .description("Create a task")
      .requiredOption("-w, --workspace-id <id>", "Workspace ID")
      .requiredOption("--title <title>", "Task title")
      .option("--description <text>", "Task description")
      .option("--priority <priority>", "Task priority")
      .option("--runtime <runtime>", "Execution runtime: openclaw or research")
      .option("--prompt <text>", "Execution prompt")
      .action(async (options: CommonCommandOptions & {
        workspaceId: string;
        title: string;
        description?: string;
        priority?: string;
        runtime?: string;
        prompt?: string;
      }) => {
        await runCommand(
          () =>
            getClient().createTask({
              workspaceId: options.workspaceId,
              title: options.title,
              description: options.description,
              priority: options.priority,
              executionRuntime: parseExecutionRuntime(options.runtime),
              executionConfig: buildExecutionConfig(options.prompt),
            }),
          options,
          formatTaskDetail,
        );
      }),
  );

  createOutputOption(
    task
      .command("update")
      .description("Update a task")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .option("--title <title>", "Task title")
      .option("--description <text>", "Task description")
      .option("--priority <priority>", "Task priority")
      .option("--runtime <runtime>", "Execution runtime: openclaw or research")
      .option("--prompt <text>", "Execution prompt")
      .action(async (options: CommonCommandOptions & {
        taskId: string;
        title?: string;
        description?: string;
        priority?: string;
        runtime?: string;
        prompt?: string;
      }) => {
        await runCommand(
          () =>
            getClient().updateTask(options.taskId, {
              title: options.title,
              description: options.description,
              priority: options.priority,
              executionRuntime: parseExecutionRuntime(options.runtime),
              executionConfig: buildExecutionConfig(options.prompt),
            }),
          options,
          formatTaskDetail,
        );
      }),
  );

  createOutputOption(
    task
      .command("done")
      .description("Mark a task done")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(() => getClient().markDone(options.taskId), options, formatRunResult);
      }),
  );

  createOutputOption(
    task
      .command("reopen")
      .description("Reopen a task")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(() => getClient().reopenTask(options.taskId), options, formatRunResult);
      }),
  );

  createOutputOption(
    task
      .command("delete")
      .description("Delete a task")
      .requiredOption("-t, --task-id <id>", "Task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(() => getClient().deleteTask(options.taskId), options, formatRunResult);
      }),
  );

}
