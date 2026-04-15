/**
 * CLI command: suggest-automation
 * Calls POST /api/ai/suggest-automation and displays the result.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import {
  formatAutomation,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerSuggestAutomation(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("suggest-automation")
    .description("Get automation suggestions for a task")
    .requiredOption("-t, --task-id <id>", "Task ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { taskId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.suggestAutomation(opts.taskId);
        const format = opts.output as OutputFormat;
        console.log(formatAutomation(data, format));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });
}
