/**
 * CLI command: analyze-conflicts
 * Calls POST /api/ai/analyze-conflicts and displays the result.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import {
  formatConflicts,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerAnalyzeConflicts(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("analyze-conflicts")
    .description("Analyze scheduling conflicts for a workspace")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .option("-d, --date <date>", "Date to analyze (YYYY-MM-DD); defaults to next 7 days")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { workspaceId: string; date?: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.analyzeConflicts(opts.workspaceId, opts.date);
        const format = opts.output as OutputFormat;
        console.log(formatConflicts(data, format));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });
}
