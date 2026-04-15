/**
 * CLI command: get-workspace
 * Calls GET /api/schedule/projection?workspaceId=xxx and displays the result.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import {
  formatWorkspace,
  printError,
  type OutputFormat,
} from "../lib/output-formatter.js";

export function registerGetWorkspace(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("get-workspace")
    .description("Get workspace schedule projection and summary")
    .requiredOption("-w, --workspace-id <id>", "Workspace ID")
    .option("-o, --output <format>", "Output format: json or table", "json")
    .action(async (opts: { workspaceId: string; output: string }) => {
      try {
        const client = getClient();
        const data = await client.getWorkspace(opts.workspaceId);
        const format = opts.output as OutputFormat;
        console.log(formatWorkspace(data, format));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
    });
}
