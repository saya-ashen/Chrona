#!/usr/bin/env bun
/**
 * AgentDashboard CLI — agentdash
 *
 * A command-line interface for interacting with the AgentDashboard backend API.
 *
 * Usage:
 *   bun src/cli/index.ts <command> [options]
 *
 * Commands:
 *   analyze-conflicts    Analyze scheduling conflicts for a workspace
 *   suggest-automation   Get automation suggestions for a task
 *   apply-suggestion     Apply a scheduling suggestion
 *   get-workspace        Get workspace schedule projection
 *
 * Global options:
 *   --base-url <url>     Override the API base URL (default: http://localhost:3000)
 */

import { Command } from "commander";
import { ApiClient } from "./lib/api-client.js";
import { registerAnalyzeConflicts } from "./commands/analyze-conflicts.js";
import { registerSuggestAutomation } from "./commands/suggest-automation.js";
import { registerApplySuggestion } from "./commands/apply-suggestion.js";
import { registerDecomposeTask } from "./commands/decompose-task.js";
import { registerSuggestTimeslot } from "./commands/suggest-timeslot.js";
import { registerGetWorkspace } from "./commands/get-workspace.js";

const program = new Command();

program
  .name("agentdash")
  .description("AgentDashboard CLI — manage schedules, analyze conflicts, and automate tasks")
  .version("0.1.0")
  .option("--base-url <url>", "API base URL", "http://localhost:3000");

/**
 * Lazily create an ApiClient using the resolved --base-url option.
 * This factory is passed to each subcommand so the client picks up
 * the global option even when it appears before the subcommand name.
 */
function getClient(): ApiClient {
  const opts = program.opts<{ baseUrl: string }>();
  return new ApiClient(opts.baseUrl);
}

// Register subcommands
registerAnalyzeConflicts(program, getClient);
registerSuggestAutomation(program, getClient);
registerApplySuggestion(program, getClient);
registerDecomposeTask(program, getClient);
registerSuggestTimeslot(program, getClient);
registerGetWorkspace(program, getClient);

// Parse argv and run
program.parseAsync(process.argv);
