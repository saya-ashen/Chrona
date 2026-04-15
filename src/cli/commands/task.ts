/**
 * CLI command group: task
 *
 * Subcommands:
 *   task list      - List tasks in a workspace
 *   task get       - Get task details
 *   task create    - Create a new task
 *   task update    - Update an existing task
 *   task done      - Mark a task as done
 *   task reopen    - Reopen a completed task
 *   task plan      - Generate a plan for a task
 */

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import {
  output,
  formatTaskList,
  formatTaskDetail,
  formatRunResult,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerTaskCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const task = program
    .command("task")
    .description("Task management commands");

  // ── task list ──────────────────────────────────────────────────────
  task
    .command("list")
    .description("List tasks for a workspace")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .option("-s, --status <status>", "Filter by status")
    .option("-l, --limit <n>", "Maximum number of tasks to return", "50")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { workspaceId: string; status?: string; limit: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.listTasks(opts.workspaceId, {
          status: opts.status,
          limit: parseInt(opts.limit, 10),
        });
        console.log(output(data, opts.output as OutputFormat, formatTaskList));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── task get ───────────────────────────────────────────────────────
  task
    .command("get")
    .description("Get task details by ID")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.getTask(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatTaskDetail));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── task create ────────────────────────────────────────────────────
  task
    .command("create")
    .description("Create a new task")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .requiredOption("--title <title>", "Task title")
    .option("--description <desc>", "Task description")
    .option("--priority <priority>", "Priority: Low, Medium, High, or Urgent")
    .option("--due <date>", "Due date (ISO 8601)")
    .option("--adapter <key>", "Runtime adapter key")
    .option("--model <model>", "Runtime model identifier")
    .option("--prompt <prompt>", "Task prompt")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: {
      workspaceId: string;
      title: string;
      description?: string;
      priority?: string;
      due?: string;
      adapter?: string;
      model?: string;
      prompt?: string;
      output: string;
    }) => {
      try {
        const client = getClient();
        const data = await client.createTask({
          workspaceId: opts.workspaceId,
          title: opts.title,
          description: opts.description,
          priority: opts.priority,
          dueAt: opts.due,
          runtimeAdapterKey: opts.adapter,
          runtimeModel: opts.model,
          prompt: opts.prompt,
        });
        console.log(output(data, opts.output as OutputFormat, formatTaskDetail));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── task update ────────────────────────────────────────────────────
  task
    .command("update")
    .description("Update an existing task")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("--title <title>", "New title")
    .option("--description <desc>", "New description")
    .option("--priority <priority>", "New priority: Low, Medium, High, or Urgent")
    .option("--due <date>", "New due date (ISO 8601)")
    .option("--model <model>", "New runtime model")
    .option("--prompt <prompt>", "New prompt")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: {
      taskId: string;
      title?: string;
      description?: string;
      priority?: string;
      due?: string;
      model?: string;
      prompt?: string;
      output: string;
    }) => {
      try {
        const client = getClient();
        const body: Record<string, string> = {};
        if (opts.title) body.title = opts.title;
        if (opts.description) body.description = opts.description;
        if (opts.priority) body.priority = opts.priority;
        if (opts.due) body.dueAt = opts.due;
        if (opts.model) body.runtimeModel = opts.model;
        if (opts.prompt) body.prompt = opts.prompt;
        const data = await client.updateTask(opts.taskId, body);
        console.log(output(data, opts.output as OutputFormat, formatTaskDetail));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── task done ──────────────────────────────────────────────────────
  task
    .command("done")
    .description("Mark a task as done")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.markDone(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── task reopen ────────────────────────────────────────────────────
  task
    .command("reopen")
    .description("Reopen a completed task")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.reopenTask(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── task plan ──────────────────────────────────────────────────────
  task
    .command("plan")
    .description("Generate a plan for a task")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.generatePlan(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });
}
