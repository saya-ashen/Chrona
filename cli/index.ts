#!/usr/bin/env bun
/**
 * AgentDashboard CLI — agentdash
 *
 * A comprehensive command-line interface for interacting with the
 * AgentDashboard backend API. Designed to be AI-agent-friendly with
 * structured JSON output by default.
 *
 * Usage:
 *   bun cli/index.ts <group> <command> [options]
 *
 * Command Groups:
 *   task       Task management (list, get, create, update, done, reopen, plan)
 *   run        Run management (start, message, input)
 *   schedule   Schedule management (apply, clear, view, conflicts, suggest-time)
 *   ai         AI-powered features (decompose, suggest-automation, apply-suggestion)
 *
 * Global options:
 *   --base-url <url>     Override the API base URL (default: http://localhost:3000)
 *
 * All commands support:
 *   -o, --output <format>   Output format: json (default) or table
 */

import { Command } from "commander";
import { ApiClient } from "./lib/api-client.js";
import { registerTaskCommands } from "./commands/task.js";
import { registerRunCommands } from "./commands/run.js";
import { registerScheduleCommands } from "./commands/schedule.js";
import { registerAiCommands } from "./commands/ai.js";

const program = new Command();

program
  .name("agentdash")
  .description(
    "AgentDashboard CLI — manage tasks, runs, schedules, and AI features.\n" +
    "Outputs structured JSON by default for AI-agent integration.",
  )
  .version("0.2.0")
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

// Register command groups
registerTaskCommands(program, getClient);
registerRunCommands(program, getClient);
registerScheduleCommands(program, getClient);
registerAiCommands(program, getClient);

// Parse argv and run
program.parseAsync(process.argv);
