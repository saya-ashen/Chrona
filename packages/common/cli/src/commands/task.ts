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
        await runCommand(() => getClient().getTask(options.taskId), options, formatTaskDetail);
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
      .option("--due <datetime>", "Due date as ISO-8601")
      .option("--adapter <key>", "Runtime adapter key")
      .option("--model <model>", "Runtime model")
      .option("--prompt <text>", "Task prompt")
      .action(async (options: CommonCommandOptions & {
        workspaceId: string;
        title: string;
        description?: string;
        priority?: string;
        due?: string;
        adapter?: string;
        model?: string;
        prompt?: string;
      }) => {
        await runCommand(
          () =>
            getClient().createTask({
              workspaceId: options.workspaceId,
              title: options.title,
              description: options.description,
              priority: options.priority,
              dueAt: options.due,
              runtimeAdapterKey: options.adapter,
              runtimeModel: options.model,
              prompt: options.prompt,
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
      .option("--due <datetime>", "Due date as ISO-8601")
      .option("--model <model>", "Runtime model")
      .option("--adapter <key>", "Runtime adapter key")
      .option("--prompt <text>", "Task prompt")
      .action(async (options: CommonCommandOptions & {
        taskId: string;
        title?: string;
        description?: string;
        priority?: string;
        due?: string;
        model?: string;
        adapter?: string;
        prompt?: string;
      }) => {
        await runCommand(
          () =>
            getClient().updateTask(options.taskId, {
              title: options.title,
              description: options.description,
              priority: options.priority,
              dueAt: options.due,
              runtimeModel: options.model,
              runtimeAdapterKey: options.adapter,
              prompt: options.prompt,
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

  createOutputOption(
    task
      .command("subtasks")
      .description("List task subtasks")
      .requiredOption("-t, --task-id <id>", "Parent task ID")
      .action(async (options: CommonCommandOptions & { taskId: string }) => {
        await runCommand(() => getClient().listSubtasks(options.taskId), options, formatTaskList);
      }),
  );

  createOutputOption(
    task
      .command("add-subtask")
      .description("Create a subtask")
      .requiredOption("-t, --task-id <id>", "Parent task ID")
      .requiredOption("--title <title>", "Subtask title")
      .option("--description <text>", "Subtask description")
      .option("--priority <priority>", "Subtask priority")
      .option("--due <datetime>", "Due date as ISO-8601")
      .action(async (options: CommonCommandOptions & {
        taskId: string;
        title: string;
        description?: string;
        priority?: string;
        due?: string;
      }) => {
        await runCommand(
          () =>
            getClient().createSubtask(options.taskId, {
              title: options.title,
              description: options.description,
              priority: options.priority,
              dueAt: options.due,
            }),
          options,
          formatTaskDetail,
        );
      }),
  );
}
