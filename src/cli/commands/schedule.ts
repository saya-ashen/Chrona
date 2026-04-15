/**
 * CLI command group: schedule
 *
 * Subcommands:
 *   schedule apply          - Schedule a task with start/end times
 *   schedule clear          - Clear a task's schedule
 *   schedule view           - View workspace schedule projection
 *   schedule conflicts      - Analyze scheduling conflicts
 *   schedule suggest-time   - Suggest a timeslot for a task
 */

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import {
  output,
  formatWorkspace,
  formatConflicts,
  formatRunResult,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerScheduleCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const schedule = program
    .command("schedule")
    .description("Schedule management commands");

  // ── schedule apply ─────────────────────────────────────────────────
  schedule
    .command("apply")
    .description("Schedule a task with start and end times")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .requiredOption("--start <datetime>", "Scheduled start (ISO 8601)")
    .requiredOption("--end <datetime>", "Scheduled end (ISO 8601)")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; start: string; end: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.scheduleTask(opts.taskId, opts.start, opts.end);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── schedule clear ─────────────────────────────────────────────────
  schedule
    .command("clear")
    .description("Clear a task's schedule")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.clearSchedule(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── schedule view ──────────────────────────────────────────────────
  schedule
    .command("view")
    .description("View workspace schedule projection / overview")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { workspaceId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.getScheduleProjection(opts.workspaceId);
        console.log(output(data, opts.output as OutputFormat, formatWorkspace));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── schedule conflicts ─────────────────────────────────────────────
  schedule
    .command("conflicts")
    .description("Analyze scheduling conflicts for a workspace")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .option("-d, --date <date>", "Date to analyze (YYYY-MM-DD); defaults to next 7 days")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { workspaceId: string; date?: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.analyzeConflicts(opts.workspaceId, opts.date);
        console.log(output(data, opts.output as OutputFormat, formatConflicts));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── schedule suggest-time ──────────────────────────────────────────
  schedule
    .command("suggest-time")
    .description("Suggest a timeslot for scheduling a task")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-d, --date <date>", "Target date (YYYY-MM-DD)")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { workspaceId: string; taskId: string; date?: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.suggestTimeslot(opts.workspaceId, opts.taskId, opts.date);
        console.log(output(data, opts.output as OutputFormat));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });
}
