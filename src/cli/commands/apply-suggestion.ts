/**
 * CLI command: apply-suggestion
 * Calls POST /api/ai/apply-suggestion and displays the result.
 */

import { Command } from "commander";
import { ApiClient, type TaskChange } from "../lib/api-client.js";
import {
  formatSuggestions,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerApplySuggestion(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("apply-suggestion")
    .description("Apply a scheduling suggestion to a workspace")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .requiredOption("-s, --suggestion-id <id>", "Suggestion ID to apply")
    .requiredOption(
      "-c, --changes <json>",
      'Task changes as JSON array, e.g. \'[{"taskId":"abc","scheduledStartAt":"2025-01-01T09:00:00Z"}]\'',
    )
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(
      async (opts: {
        workspaceId: string;
        suggestionId: string;
        changes: string;
        output: string;
      }) => {
        let changes: TaskChange[];
        try {
          changes = JSON.parse(opts.changes) as TaskChange[];
        } catch {
          printError(
            "Invalid JSON for --changes. Expected a JSON array of TaskChange objects.",
          );
        }

        try {
          const client = getClient();
          const data = await client.applySuggestion(
            opts.workspaceId,
            opts.suggestionId,
            changes!,
          );
          const format = opts.output as OutputFormat;
          console.log(formatSuggestions(data, format));
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
        }
      },
    );
}
