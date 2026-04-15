/**
 * CLI command group: ai
 *
 * Subcommands:
 *   ai decompose            - Decompose a task into subtasks
 *   ai suggest-automation   - Get automation suggestions for a task
 *   ai apply-suggestion     - Apply a scheduling suggestion
 *   ai batch-decompose      - Decompose and create subtasks in one step
 *   ai auto-complete        - Get title auto-complete suggestions
 */

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import {
  output,
  formatAutomation,
  formatSuggestions,
  formatRunResult,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerAiCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const ai = program
    .command("ai")
    .description("AI-powered analysis and automation commands");

  // ── ai decompose ───────────────────────────────────────────────────
  ai
    .command("decompose")
    .description("Decompose a task into subtasks using AI")
    .requiredOption("-t, --task-id <id>", "Task ID to decompose")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.decomposeTask(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── ai suggest-automation ──────────────────────────────────────────
  ai
    .command("suggest-automation")
    .description("Get automation suggestions for a task")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.suggestAutomation(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatAutomation));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── ai apply-suggestion ────────────────────────────────────────────
  ai
    .command("apply-suggestion")
    .description("Apply a scheduling suggestion")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .requiredOption("-s, --suggestion-id <id>", "Suggestion ID to apply")
    .requiredOption("-c, --changes <json>", "Changes as JSON array (e.g. '[{\"taskId\":\"x\",\"scheduledStartAt\":\"...\"}]')")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { workspaceId: string; suggestionId: string; changes: string; output: string }) => {
      try {
        let parsedChanges;
        try {
          parsedChanges = JSON.parse(opts.changes);
        } catch {
          printError("Invalid JSON for --changes. Expected a JSON array of TaskChange objects.");
        }
        const client = getClient();
        const data = await client.applySuggestion(
          opts.workspaceId,
          opts.suggestionId,
          parsedChanges,
        );
        console.log(output(data, opts.output as OutputFormat, formatSuggestions));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── ai batch-decompose ──────────────────────────────────────────────
  ai
    .command("batch-decompose")
    .description("Decompose a task and create subtasks in one step")
    .requiredOption("-t, --task-id <id>", "Task ID to decompose")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.batchDecompose(opts.taskId);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── ai auto-complete ────────────────────────────────────────────────
  ai
    .command("auto-complete")
    .description("Get title auto-complete suggestions")
    .requiredOption("--title <partial-title>", "Partial title to auto-complete")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { title: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.autoComplete(opts.title);
        console.log(output(data, opts.output as OutputFormat, formatRunResult));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });
}
